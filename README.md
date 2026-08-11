# mimo-vision

跨工具视觉 MCP server：把图片发给多模态模型（mimo-v2.5 系），把返回的文字描述交给主模型。stdio + JSON-RPC 2.0，Python 3 标准库、**零第三方依赖**，Windows / WSL / macOS / Linux 通用。

## 工具

| 工具 | 参数 | 说明 |
|---|---|---|
| `describe_image` | `path`（必填）、`question`（可选） | 描述图片文件，返回文字 |

## 工作原理

1. **API key 解析**：显式环境变量优先（约定俗成配置），否则自动发现当前工具的 auth 文件（零配置兜底）。
2. **线路选择**：默认免费 Zen 线路（`mimo-v2.5-free`，200K 上下文）；请求失败（超时 / 任意 4xx/5xx）时每请求回退到付费 Go 线路（`mimo-v2.5`，1M）一次；`MIMO_VISION_ALLOW_PAID=false` 可禁用付费兜底。
3. **图片预处理**：检测到 ImageMagick 时缩放长边 ≤ 2048px、JPEG q85、`-strip` 去元数据；否则原图直发。

设计决策见 [adr/0001-cross-tool-vision-mcp-auto-apikey.md](adr/0001-cross-tool-vision-mcp-auto-apikey.md)。

## 配置方式

### 方式一：显式配置（约定俗成，推荐固定/生产环境）

**Codex**（`~/.codex/config.toml`）：

```toml
[mcp_servers.mimo-vision]
command = 'python'
args = ['C:\path\to\mimo-vision\vision_server.py']
startup_timeout_sec = 120

[mcp_servers.mimo-vision.env]
MIMO_VISION_API_KEY = 'sk-...'
MIMO_VISION_BASE_URL = 'https://opencode.ai/zen/v1'
MIMO_VISION_MODEL = 'mimo-v2.5-free'
```

**Claude Desktop / Claude Code**（`claude_desktop_config.json` / 项目 `.mcp.json`）：

```json
{
  "mcpServers": {
    "mimo-vision": {
      "command": "python",
      "args": ["C:\\path\\to\\mimo-vision\\vision_server.py"],
      "env": {
        "MIMO_VISION_API_KEY": "sk-...",
        "MIMO_VISION_BASE_URL": "https://opencode.ai/zen/v1",
        "MIMO_VISION_MODEL": "mimo-v2.5-free"
      }
    }
  }
}
```

### 方式二：零配置（自动发现，推荐本机日常）

`env` 不填任何值，server 按优先级自动复用当前工具已登录的 key：

1. 环境变量：`MIMO_VISION_API_KEY` > `VISION_API_KEY` > `OPENCODE_API_KEY` > `OPENAI_API_KEY` > `ANTHROPIC_API_KEY`
2. `~/.codex/auth.json`（Codex）
3. `~/.claude/settings.json`（Claude Code；`ANTHROPIC_AUTH_TOKEN` 仅当 `ANTHROPIC_BASE_URL` 指向 opencode 类端点时采用）
4. `~/.local/share/opencode/auth.json`（仅 `opencode-go` / `opencode_go`，不取无关 provider）

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `MIMO_VISION_API_KEY` | 显式 key（最高优先级） | 无 |
| `VISION_API_KEY` / `OPENCODE_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | 显式 key（依次降级） | 无 |
| `MIMO_VISION_BASE_URL` | 显式线路 base URL（跳过自动选路，单线路不兜底） | 无 |
| `MIMO_VISION_MODEL` | 显式模型（同上） | 无 |
| `MIMO_VISION_ALLOW_PAID` | 是否允许付费线路兜底（`false`/`0`/`no`/`off` 禁用） | `true` |

## 开发

```bash
python -m unittest discover -s tests   # 运行全部测试
python vision_server.py                # 以 stdio 方式启动
```

## 失败语义

任何失败（无 key、双线路失败、文件不存在、非图片、预处理异常）都以**工具级错误**返回：`{isError: true, content: [{type: "text", text: "可操作提示"}]}`，进程不退出、连接不断开。

## 安全

- 只读 ADR 列出的指定 auth 文件，不扫描目录、不打印 / 写盘 / 上传 key；
- key 仅在请求头 `Authorization: Bearer ...` 中使用。
