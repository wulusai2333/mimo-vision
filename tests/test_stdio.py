import json
import os
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, "vision_server.py")


class StdioIntegrationTest(unittest.TestCase):

    def _run(self, messages):
        p = subprocess.Popen([sys.executable, SERVER],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             cwd=ROOT)
        payload = b"".join(
            json.dumps(m, ensure_ascii=False).encode("utf-8") + b"\n"
            for m in messages)
        out, _ = p.communicate(payload, timeout=60)
        return [json.loads(line)
                for line in out.decode("utf-8").splitlines() if line.strip()]

    def test_handshake_and_chinese_question_roundtrip(self):
        reqs = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": "2025-06-18", "capabilities": {}}},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
             "params": {"name": "describe_image",
                        "arguments": {"path": "C:\\nonexistent.png",
                                      "question": "这是什么?"}}},
        ]
        resps = self._run(reqs)
        self.assertEqual([r["id"] for r in resps], [1, 2, 3])
        call = resps[2]["result"]
        self.assertTrue(call["isError"])
        self.assertIn("不存在", call["content"][0]["text"])


if __name__ == "__main__":
    unittest.main()
