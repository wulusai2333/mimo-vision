"""mimo-vision: cross-tool vision MCP server (Python 3 stdlib only).

Exposes a single MCP tool ``describe_image(path, question?)`` over stdio
(JSON-RPC 2.0, newline-delimited). API key is resolved explicitly from env
vars first (conventional config), then auto-discovered from the current
toolchain's auth files (zero-config fallback). See ADR-0001.
"""

import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from collections import namedtuple

# Explicit env vars, highest priority (conventional config mode).
ENV_KEY_PRECEDENCE = (
    "MIMO_VISION_API_KEY",
    "VISION_API_KEY",
    "OPENCODE_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
)

# Auto-discovery sources, in order (zero-config mode).
SOURCE_FILES = (
    (".codex/auth.json", "codex"),
    (".claude/settings.json", "claude"),
    (".local/share/opencode/auth.json", "opencode"),
)

OPCODE_PROVIDER_NAMES = ("opencode-go", "opencode_go")

Route = namedtuple("Route", ["label", "base_url", "model"])

FREE_ROUTE = Route("free", "https://opencode.ai/zen/v1", "mimo-v2.5-free")
PAID_ROUTE = Route("paid", "https://opencode.ai/zen/go/v1", "mimo-v2.5")

_FALSEY = {"0", "false", "no", "off"}

_IM_MAX_EDGE = "2048x2048>"
_IM_QUALITY = "85"
_MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
}

DEFAULT_TIMEOUT_SEC = 120
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
              "AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/126.0 Safari/537.36")


class VisionError(Exception):
    """Actionable failure surfaced to the caller (and finally the user)."""


def _read_json(path):
    """Read a JSON file; return None on missing file or malformed JSON."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _first_nonempty_str(data, *names):
    """First non-empty string among ``names`` in ``data``, else None."""
    if not isinstance(data, dict):
        return None
    for name in names:
        val = data.get(name)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return None


def _codex_key(data):
    """Codex auth.json: OPENAI_API_KEY, else any *_API_KEY/_TOKEN field."""
    key = _first_nonempty_str(data, "OPENAI_API_KEY")
    if key:
        return key, None
    if isinstance(data, dict):
        for name, val in data.items():
            if isinstance(val, str) and val.strip() and (
                    name.endswith("_API_KEY") or name.endswith("_TOKEN")):
                return val.strip(), None
    return None


def _claude_key(data):
    """Claude settings.json env: OPENAI_API_KEY, or ANTHROPIC_AUTH_TOKEN
    only when ANTHROPIC_BASE_URL points at an opencode-like endpoint."""
    if not isinstance(data, dict):
        return None
    env = data.get("env")
    if not isinstance(env, dict):
        return None
    key = _first_nonempty_str(env, "OPENAI_API_KEY")
    if key:
        return key, None
    tok = _first_nonempty_str(env, "ANTHROPIC_AUTH_TOKEN")
    base = _first_nonempty_str(env, "ANTHROPIC_BASE_URL")
    if tok and base and "opencode" in base.lower():
        return tok, base
    return None


def _opencode_key(data):
    """opencode auth.json: only expected provider names; take their key."""
    if not isinstance(data, dict):
        return None
    for name in OPCODE_PROVIDER_NAMES:
        entry = data.get(name)
        if isinstance(entry, str) and entry.strip():
            return entry.strip(), None
        if isinstance(entry, dict):
            val = _first_nonempty_str(
                entry, "key", "apiKey", "token", "API_KEY", "TOKEN")
            if val:
                return val, None
    return None


_KEY_EXTRACTORS = {
    "codex": _codex_key,
    "claude": _claude_key,
    "opencode": _opencode_key,
}


def discover_api_key(home=None):
    """Resolve an API key.

    Returns ``(key, source_label, base_url_hint)``; ``base_url_hint`` is set
    only when the Claude source's ANTHROPIC_BASE_URL was used. Returns None
    when no key source matches.
    """
    for var in ENV_KEY_PRECEDENCE:
        val = os.environ.get(var)
        if val and val.strip():
            return val.strip(), "env:%s" % var, None
    if home is None:
        home = os.path.expanduser("~")
    for rel, label in SOURCE_FILES:
        path = os.path.join(home, rel.replace("/", os.sep))
        found = _KEY_EXTRACTORS[label](_read_json(path))
        if found:
            key, hint = found
            return key, label, hint
    return None


def resolve_routes(environ=None):
    """Return ``(routes, explicit)``.

    ``routes`` is an ordered list of :class:`Route`. Explicit mode (a single
    route, no fallback) applies when ``MIMO_VISION_BASE_URL`` or
    ``MIMO_VISION_MODEL`` is set; otherwise free first with paid as fallback,
    unless ``MIMO_VISION_ALLOW_PAID`` disables the paid route.
    """
    if environ is None:
        environ = os.environ
    base = environ.get("MIMO_VISION_BASE_URL")
    model = environ.get("MIMO_VISION_MODEL")
    if base or model:
        route = Route("explicit", base or FREE_ROUTE.base_url,
                      model or FREE_ROUTE.model)
        return [route], True
    routes = [FREE_ROUTE]
    allow_paid = environ.get("MIMO_VISION_ALLOW_PAID", "true")
    if allow_paid.strip().lower() not in _FALSEY:
        routes.append(PAID_ROUTE)
    return routes, False



def _http_post_json(url, headers, payload, timeout=DEFAULT_TIMEOUT_SEC):
    """POST JSON and return parsed response; raise VisionError on failure."""
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", "replace")
            status = resp.status
    except urllib.error.HTTPError as e:
        raise VisionError("HTTP %s %s" % (e.code, e.reason))
    except Exception as e:
        raise VisionError("请求失败: %s" % e)
    if status != 200:
        raise VisionError("HTTP %s" % status)
    try:
        return json.loads(body)
    except ValueError as e:
        raise VisionError("响应不是有效 JSON: %s" % e)


def _extract_content(data):
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise VisionError("响应缺少 choices[0].message.content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            part.get("text", "") for part in content if isinstance(part, dict))
    raise VisionError("无法识别的 content 类型")


def _build_payload(model, image_b64, mime, question):
    prompt = (question or "").strip() or "Describe this image in detail."
    return {
        "model": model,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url",
                 "image_url": {
                     "url": "data:%s;base64,%s" % (mime, image_b64)}},
            ],
        }],
    }


def call_vision(key, image_b64, mime, question=None, routes=None,
                environ=None, timeout=DEFAULT_TIMEOUT_SEC):
    """Send the image to the vision model; return the textual description.

    Tries each route in order (free first, paid as fallback); the first
    success wins. Raises VisionError when every route fails, with an
    actionable message.
    """
    if routes is None:
        routes, _ = resolve_routes(environ)
    if not routes:
        raise VisionError("没有可用线路")
    errors = []
    for route in routes:
        url = route.base_url.rstrip("/") + "/chat/completions"
        headers = {
            "Authorization": "Bearer %s" % key,
            "Content-Type": "application/json",
            "User-Agent": BROWSER_UA,
        }
        payload = _build_payload(route.model, image_b64, mime, question)
        try:
            data = _http_post_json(url, headers, payload, timeout)
            return _extract_content(data)
        except VisionError as e:
            errors.append(e)
    if any("401" in str(e) for e in errors):
        raise VisionError(
            "API key 无效或未被接受（401）。请设置 MIMO_VISION_API_KEY，"
            "或检查 ~/.codex/auth.json 等 key 源。")
    raise VisionError("所有线路请求失败: %s" % errors[-1])


def _guess_mime(path):
    ext = os.path.splitext(path)[1].lower()
    return _MIME_BY_EXT.get(ext, "application/octet-stream")


def _find_imagemagick():
    """Prefer ImageMagick v7 ``magick``; accept v6 ``convert`` except the
    Windows NTFS utility at System32\\convert.exe (a name collision)."""
    magick = shutil.which("magick")
    if magick:
        return magick
    convert = shutil.which("convert")
    if convert and "system32" not in convert.lower():
        return convert
    return None


def _require_file(path):
    if not os.path.isfile(path):
        raise VisionError("文件不存在: %s" % path)


def preprocess_image(path, max_edge=_IM_MAX_EDGE, quality=_IM_QUALITY):
    """Return ``(image_bytes, mime)``.

    When ImageMagick is available, resize to long edge <= 2048px, re-encode
    JPEG q85 and strip metadata; otherwise pass the raw file through.
    """
    _require_file(path)
    with open(path, "rb") as f:
        raw = f.read()
    tool = _find_imagemagick()
    if tool is None:
        return raw, _guess_mime(path)
    fd, out_path = tempfile.mkstemp(suffix=".jpg")
    os.close(fd)
    try:
        proc = subprocess.run(
            [tool, path, "-resize", max_edge, "-quality", quality,
             "-strip", out_path],
            capture_output=True)
        if proc.returncode != 0:
            raise VisionError(
                "图片预处理失败: %s"
                % proc.stderr.decode("utf-8", "replace").strip())
        with open(out_path, "rb") as f:
            return f.read(), "image/jpeg"
    finally:
        try:
            os.remove(out_path)
        except OSError:
            pass


def _routes_for_key(hint):
    """Route list honoring a discovered opencode-like base URL hint.

    When the Claude source supplies an opencode-like ANTHROPIC_BASE_URL, route
    there directly (single route; no paid fallback with a foreign key).
    """
    if hint:
        return [Route("claude", hint, FREE_ROUTE.model)]
    routes, _explicit = resolve_routes()
    return routes


def describe_image(path, question=None):
    """Tool body: discover key, preprocess image, call the vision model."""
    _require_file(path)
    data, mime = preprocess_image(path)
    image_b64 = base64.b64encode(data).decode("ascii")
    found = discover_api_key()
    if found is None:
        raise VisionError(
            "未找到可用的 API key。请设置环境变量 MIMO_VISION_API_KEY，"
            "或确保 Codex/Claude Code/opencode 已登录"
            "（~/.codex/auth.json 等）。")
    key, _source, hint = found
    return call_vision(key, image_b64, mime, question,
                       _routes_for_key(hint))


TOOL_SPEC = {
    "name": "describe_image",
    "description": "Describe an image file using a vision model and return "
                   "a textual description.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "path": {"type": "string",
                     "description": "Path to the image file."},
            "question": {"type": "string",
                         "description": "Optional question about the image."},
        },
        "required": ["path"],
    },
}

PROTOCOL_VERSION = "2025-06-18"
SERVER_NAME = "mimo-vision"
SERVER_VERSION = "0.1.0"


def _rpc_response(req_id, result=None, error=None):
    out = {"jsonrpc": "2.0", "id": req_id}
    if error is not None:
        out["error"] = error
    else:
        out["result"] = result
    return out


def _handle_request(req):
    method = req.get("method")
    req_id = req.get("id")
    if method == "initialize":
        return _rpc_response(req_id, {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
        })
    if method == "tools/list":
        return _rpc_response(req_id, {"tools": [TOOL_SPEC]})
    if method == "tools/call":
        params = req.get("params") or {}
        name = params.get("name")
        args = params.get("arguments") or {}
        if name != TOOL_SPEC["name"]:
            result = {"content": [{"type": "text",
                                   "text": "未知工具: %s" % name}],
                      "isError": True}
            return _rpc_response(req_id, result)
        try:
            text = describe_image(**args)
            result = {"content": [{"type": "text", "text": text}],
                      "isError": False}
        except VisionError as e:
            result = {"content": [{"type": "text", "text": str(e)}],
                      "isError": True}
        except Exception as e:  # never crash the server on a single call
            result = {"content": [{"type": "text", "text": "内部错误: %s" % e}],
                      "isError": True}
        return _rpc_response(req_id, result)
    if method == "ping":
        return _rpc_response(req_id, {})
    return _rpc_response(req_id, error={"code": -32601,
                                        "message": "Method not found"})


def handle_line(raw):
    """Process one newline-delimited JSON-RPC message.

    Returns the response line to write to stdout, or None (notifications,
    malformed input, empty lines).
    """
    raw = (raw or "").strip()
    if raw.startswith("\ufeff"):  # tolerate a UTF-8 BOM on the first line
        raw = raw[1:]
    if not raw:
        return None
    try:
        req = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(req, dict) or "id" not in req:
        return None  # notification or junk
    return json.dumps(_handle_request(req), ensure_ascii=False)


def main():
    for line in sys.stdin:
        resp = handle_line(line)
        if resp:
            sys.stdout.write(resp + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
