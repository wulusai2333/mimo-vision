import io
import json
import os
import tempfile
import unittest
from unittest import mock

import vision_server as vs


def make_home(files):
    """files: dict of relative path -> JSON-serializable content."""
    d = tempfile.mkdtemp()
    for rel, content in files.items():
        p = os.path.join(d, rel.replace("/", os.sep))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with io.open(p, "w", encoding="utf-8") as f:
            json.dump(content, f)
    return d


class DiscoverApiKeyTest(unittest.TestCase):

    def _clear_env(self):
        for k in ("MIMO_VISION_API_KEY", "VISION_API_KEY", "OPENCODE_API_KEY",
                  "OPENAI_API_KEY", "ANTHROPIC_API_KEY"):
            os.environ.pop(k, None)

    def test_env_precedence_highest_wins(self):
        self._clear_env()
        with mock.patch.dict(os.environ, {
            "MIMO_VISION_API_KEY": "k-mimo",
            "VISION_API_KEY": "k-vision",
            "OPENAI_API_KEY": "k-openai",
        }):
            key, source, _ = vs.discover_api_key(home=make_home({}))
        self.assertEqual(key, "k-mimo")
        self.assertEqual(source, "env:MIMO_VISION_API_KEY")

    def test_env_falls_back_in_order(self):
        self._clear_env()
        with mock.patch.dict(os.environ, {
            "VISION_API_KEY": "k-vision",
            "ANTHROPIC_API_KEY": "k-anthropic",
        }):
            key, source, _ = vs.discover_api_key(home=make_home({}))
        self.assertEqual(key, "k-vision")
        self.assertEqual(source, "env:VISION_API_KEY")

    def test_codex_auth_json(self):
        self._clear_env()
        home = make_home({".codex/auth.json": {"OPENAI_API_KEY": "k-codex"}})
        key, source, _ = vs.discover_api_key(home=home)
        self.assertEqual(key, "k-codex")
        self.assertEqual(source, "codex")

    def test_claude_settings_env_openai_key(self):
        self._clear_env()
        home = make_home({".claude/settings.json": {"env": {"OPENAI_API_KEY": "k-claude"}}})
        key, source, _ = vs.discover_api_key(home=home)
        self.assertEqual(key, "k-claude")
        self.assertEqual(source, "claude")

    def test_claude_anthropic_token_requires_opencode_base_url(self):
        self._clear_env()
        home = make_home({".claude/settings.json": {
            "env": {"ANTHROPIC_AUTH_TOKEN": "k-tok", "ANTHROPIC_BASE_URL": "https://opencode.ai/zen/v1"}}})
        key, source, hint = vs.discover_api_key(home=home)
        self.assertEqual(key, "k-tok")
        self.assertEqual(source, "claude")
        self.assertEqual(hint, "https://opencode.ai/zen/v1")

    def test_claude_anthropic_token_ignored_without_opencode_base_url(self):
        self._clear_env()
        home = make_home({".claude/settings.json": {
            "env": {"ANTHROPIC_AUTH_TOKEN": "k-tok", "ANTHROPIC_BASE_URL": "https://api.anthropic.com"}}})
        self.assertIsNone(vs.discover_api_key(home=home))

    def test_opencode_only_expected_provider_names(self):
        self._clear_env()
        home = make_home({".local/share/opencode/auth.json": {
            "opencode-go": {"key": "k-go"},
            "deepseek": {"key": "k-deepseek"},
        }})
        key, source, _ = vs.discover_api_key(home=home)
        self.assertEqual(key, "k-go")
        self.assertEqual(source, "opencode")

    def test_opencode_ignores_unrelated_provider(self):
        self._clear_env()
        home = make_home({".local/share/opencode/auth.json": {"deepseek": {"key": "k-deepseek"}}})
        self.assertIsNone(vs.discover_api_key(home=home))

    def test_malformed_json_skipped(self):
        self._clear_env()
        d = tempfile.mkdtemp()
        p = os.path.join(d, ".codex", "auth.json")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with io.open(p, "w", encoding="utf-8") as f:
            f.write("{not json")
        self.assertIsNone(vs.discover_api_key(home=d))

    def test_codex_compat_extension_any_api_key_field(self):
        self._clear_env()
        home = make_home({".codex/auth.json": {"PROVIDER_API_KEY": "k-p"}})
        key, source, _ = vs.discover_api_key(home=home)
        self.assertEqual(key, "k-p")

    def test_opencode_real_entry_shape(self):
        # Real opencode auth.json entries: {"opencode-go": {"type": "api", "key": "sk-..."}}
        self._clear_env()
        home = make_home({".local/share/opencode/auth.json": {
            "opencode-go": {"type": "api", "key": "sk-real"}}})
        key, source, _ = vs.discover_api_key(home=home)
        self.assertEqual(key, "sk-real")
        self.assertEqual(source, "opencode")

    def test_unreadable_path_skipped(self):
        # A directory is not a readable file -> OSError path must be skipped
        self._clear_env()
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, ".codex"), exist_ok=True)
        self.assertIsNone(vs.discover_api_key(home=d))


if __name__ == "__main__":
    unittest.main()
