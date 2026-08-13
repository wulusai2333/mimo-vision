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


def make_home_text(files):
    """files: dict of relative path -> raw text content (e.g. flat YAML)."""
    d = tempfile.mkdtemp()
    for rel, content in files.items():
        p = os.path.join(d, rel.replace("/", os.sep))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with io.open(p, "w", encoding="utf-8") as f:
            f.write(content)
    return d


class DiscoverApiKeyTest(unittest.TestCase):

    def _clear_env(self):
        for k in ("OPENCODE_API_KEY", "OPENCODE_GO_API_KEY",
                  "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
                  "MIMO_VISION_API_KEY", "VISION_API_KEY"):
            os.environ.pop(k, None)

    def test_env_precedence_highest_wins(self):
        self._clear_env()
        with mock.patch.dict(os.environ, {
            "OPENCODE_API_KEY": "k-opencode",
            "OPENCODE_GO_API_KEY": "k-opencode-go",
        }):
            key, source = vs.discover_api_key(home=make_home({}))
        self.assertEqual(key, "k-opencode")
        self.assertEqual(source, "env:OPENCODE_API_KEY")

    def test_env_falls_back_in_order(self):
        self._clear_env()
        with mock.patch.dict(os.environ, {
            "OPENCODE_GO_API_KEY": "k-opencode",
        }):
            key, source = vs.discover_api_key(home=make_home({}))
        self.assertEqual(key, "k-opencode")
        self.assertEqual(source, "env:OPENCODE_GO_API_KEY")

    def test_foreign_env_keys_ignored(self):
        # Generic/other-tool keys must never be sent to the opencode Zen
        # endpoint; only the two opencode env names are recognized.
        self._clear_env()
        with mock.patch.dict(os.environ, {
            "MIMO_VISION_API_KEY": "k-mimo",
            "VISION_API_KEY": "k-vision",
            "OPENAI_API_KEY": "k-openai",
            "ANTHROPIC_API_KEY": "k-anthropic",
        }):
            self.assertIsNone(vs.discover_api_key(home=make_home({})))

    def test_opencode_only_expected_provider_names(self):
        self._clear_env()
        home = make_home({".local/share/opencode/auth.json": {
            "opencode-go": {"key": "k-go"},
            "deepseek": {"key": "k-deepseek"},
        }})
        key, source = vs.discover_api_key(home=home)
        self.assertEqual(key, "k-go")
        self.assertEqual(source, "opencode")

    def test_opencode_ignores_unrelated_provider(self):
        self._clear_env()
        home = make_home({".local/share/opencode/auth.json": {"deepseek": {"key": "k-deepseek"}}})
        self.assertIsNone(vs.discover_api_key(home=home))

    def test_malformed_json_skipped(self):
        self._clear_env()
        d = tempfile.mkdtemp()
        p = os.path.join(d, ".local", "share", "opencode", "auth.json")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with io.open(p, "w", encoding="utf-8") as f:
            f.write("{not json")
        self.assertIsNone(vs.discover_api_key(home=d))

    def test_opencode_real_entry_shape(self):
        # Real opencode auth.json entries: {"opencode-go": {"type": "api", "key": "sk-..."}}
        self._clear_env()
        home = make_home({".local/share/opencode/auth.json": {
            "opencode-go": {"type": "api", "key": "sk-real"}}})
        key, source = vs.discover_api_key(home=home)
        self.assertEqual(key, "sk-real")
        self.assertEqual(source, "opencode")

    def test_unreadable_path_skipped(self):
        # A directory is not a readable file -> OSError path must be skipped
        self._clear_env()
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, ".local", "share", "opencode"), exist_ok=True)
        self.assertIsNone(vs.discover_api_key(home=d))


class DiscoverDshKeyTest(unittest.TestCase):

    def _clear_env(self):
        for k in ("OPENCODE_API_KEY", "OPENCODE_GO_API_KEY",
                  "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
                  "MIMO_VISION_API_KEY", "VISION_API_KEY"):
            os.environ.pop(k, None)

    def test_dsh_matches_opencode_go_and_ignores_others(self):
        self._clear_env()
        home = make_home_text({".dsh/.credentials.yaml": (
            "DEEPSEEK_API_KEY: sk-deepseek\n"
            "OPENCODE_GO_API_KEY: sk-opencode-go\n")})
        key, source = vs.discover_api_key(home=home)
        self.assertEqual(key, "sk-opencode-go")
        self.assertEqual(source, "dsh")

    def test_dsh_matches_opencode_api_key(self):
        self._clear_env()
        home = make_home_text({".dsh/.credentials.yaml": (
            "DEEPSEEK_API_KEY: sk-deepseek\n"
            "OPENCODE_API_KEY: sk-opencode-api\n")})
        key, source = vs.discover_api_key(home=home)
        self.assertEqual(key, "sk-opencode-api")
        self.assertEqual(source, "dsh")

    def test_dsh_ignores_unrelated_keys(self):
        self._clear_env()
        home = make_home_text({".dsh/.credentials.yaml": (
            "DEEPSEEK_API_KEY: sk-deepseek\n")})
        self.assertIsNone(vs.discover_api_key(home=home))

    def test_dsh_missing_file_skipped_to_next_source(self):
        self._clear_env()
        home = make_home({".local/share/opencode/auth.json": {
            "opencode-go": {"key": "k-opencode"}}})
        key, source = vs.discover_api_key(home=home)
        self.assertEqual(key, "k-opencode")
        self.assertEqual(source, "opencode")

    def test_dsh_source_checked_before_opencode(self):
        self._clear_env()
        home = make_home_text({
            ".dsh/.credentials.yaml": "OPENCODE_GO_API_KEY: k-dsh\n",
            ".local/share/opencode/auth.json": "garbage not json",
        })
        # dsh reader parses its file fine; even though opencode is unreadable,
        # dsh is hit first and must win.
        key, source = vs.discover_api_key(home=home)
        self.assertEqual(key, "k-dsh")
        self.assertEqual(source, "dsh")

    def test_env_still_beats_dsh(self):
        home = make_home_text({".dsh/.credentials.yaml": (
            "OPENCODE_GO_API_KEY: sk-opencode-go\n")})
        with mock.patch.dict(os.environ, {
            "OPENCODE_API_KEY": "k-explicit", "OPENCODE_GO_API_KEY": "k-e2"}):
            key, source = vs.discover_api_key(home=home)
        self.assertEqual(key, "k-explicit")
        self.assertEqual(source, "env:OPENCODE_API_KEY")

    def test_dsh_missing_credentials_dir_skipped(self):
        self._clear_env()
        d = tempfile.mkdtemp()
        # No ~/.dsh/.credentials.yaml at all -> skipped, nothing discovered
        self.assertIsNone(vs.discover_api_key(home=d))

    def test_dsh_flat_parser_tolerates_quotes_and_comments(self):
        self._clear_env()
        home = make_home_text({".dsh/.credentials.yaml": (
            "# comment line\n"
            "OPENCODE_GO_API_KEY: 'sk-quoted'   # inline comment\n"
            "OPENCODE_API_KEY: \"sk-dq\"\n")})
        key, _ = vs.discover_api_key(home=home)
        self.assertEqual(key, "sk-quoted")


if __name__ == "__main__":
    unittest.main()
