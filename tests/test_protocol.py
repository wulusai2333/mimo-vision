import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import vision_server as vs


def send(raw):
    out = vs.handle_line(raw)
    return json.loads(out) if out else None


class HandleLineTest(unittest.TestCase):

    def test_initialize(self):
        resp = send(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                                "params": {"protocolVersion": "2025-06-18", "capabilities": {}}}))
        self.assertEqual(resp["id"], 1)
        self.assertEqual(resp["result"]["serverInfo"]["name"], "mimo-vision")
        self.assertEqual(resp["result"]["capabilities"]["tools"]["listChanged"], False)

    def test_initialized_notification_no_response(self):
        self.assertIsNone(send(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"})))

    def test_tools_list(self):
        resp = send(json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}))
        tools = resp["result"]["tools"]
        self.assertEqual([t["name"] for t in tools], ["describe_image"])
        schema = tools[0]["inputSchema"]
        self.assertIn("path", schema["properties"])
        self.assertEqual(schema["required"], ["path"])

    def test_ping(self):
        resp = send(json.dumps({"jsonrpc": "2.0", "id": 3, "method": "ping"}))
        self.assertEqual(resp["result"], {})

    def test_unknown_method_error(self):
        resp = send(json.dumps({"jsonrpc": "2.0", "id": 4, "method": "bogus"}))
        self.assertEqual(resp["error"]["code"], -32601)

    def test_tools_call_success(self):
        with mock.patch("vision_server.describe_image", return_value="a cat"):
            resp = send(json.dumps({"jsonrpc": "2.0", "id": 5, "method": "tools/call",
                                    "params": {"name": "describe_image",
                                               "arguments": {"path": "C:\\x.png", "question": "what?"}}}))
        self.assertFalse(resp["result"]["isError"])
        self.assertEqual(resp["result"]["content"][0]["text"], "a cat")

    def test_tools_call_error_is_tool_error(self):
        with mock.patch("vision_server.describe_image", side_effect=vs.VisionError("no key")):
            resp = send(json.dumps({"jsonrpc": "2.0", "id": 6, "method": "tools/call",
                                    "params": {"name": "describe_image", "arguments": {"path": "x.png"}}}))
        self.assertTrue(resp["result"]["isError"])
        self.assertIn("no key", resp["result"]["content"][0]["text"])

    def test_tools_call_unknown_tool(self):
        with mock.patch("vision_server.describe_image"):
            resp = send(json.dumps({"jsonrpc": "2.0", "id": 7, "method": "tools/call",
                                    "params": {"name": "nope", "arguments": {}}}))
        self.assertTrue(resp["result"]["isError"])

    def test_malformed_json_ignored(self):
        self.assertIsNone(send("{not json"))

    def test_empty_line_ignored(self):
        self.assertIsNone(send(""))

    def test_leading_bom_ignored(self):
        resp = send("\ufeff" + json.dumps({"jsonrpc": "2.0", "id": 9, "method": "ping"}))
        self.assertEqual(resp["id"], 9)
        self.assertEqual(resp["result"], {})


if __name__ == "__main__":
    unittest.main()
