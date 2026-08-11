import base64
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import vision_server as vs


def write_tmp(data=b"img"):
    d = tempfile.mkdtemp()
    p = os.path.join(d, "a.png")
    with open(p, "wb") as f:
        f.write(data)
    return p


class DescribeImageTest(unittest.TestCase):

    def test_missing_file_raises(self):
        with self.assertRaises(vs.VisionError) as cm:
            vs.describe_image(os.path.join(tempfile.gettempdir(), "nope.png"))
        self.assertIn("不存在", str(cm.exception))

    def test_no_key_raises_actionable(self):
        p = write_tmp()
        with mock.patch("vision_server.discover_api_key", return_value=None), \
             mock.patch("vision_server.preprocess_image", return_value=(b"x", "image/png")):
            with self.assertRaises(vs.VisionError) as cm:
                vs.describe_image(p)
        self.assertIn("MIMO_VISION_API_KEY", str(cm.exception))

    def test_happy_path_passes_b64_and_question(self):
        p = write_tmp(b"\x00\x01")
        seen = {}
        def fake_call(key, image_b64, mime, question=None, routes=None):
            seen.update(key=key, b64=image_b64, mime=mime, question=question)
            return "a cat"
        with mock.patch("vision_server.discover_api_key", return_value=("k", "codex", None)), \
             mock.patch("vision_server.preprocess_image", return_value=(b"\x00\x01", "image/png")), \
             mock.patch("vision_server.call_vision", side_effect=fake_call):
            text = vs.describe_image(p, question="what?")
        self.assertEqual(text, "a cat")
        self.assertEqual(seen["key"], "k")
        self.assertEqual(seen["b64"], base64.b64encode(b"\x00\x01").decode("ascii"))
        self.assertEqual(seen["mime"], "image/png")
        self.assertEqual(seen["question"], "what?")

    def test_call_vision_error_propagates(self):
        p = write_tmp()
        with mock.patch("vision_server.discover_api_key", return_value=("k", "codex", None)), \
             mock.patch("vision_server.preprocess_image", return_value=(b"x", "image/png")), \
             mock.patch("vision_server.call_vision", side_effect=vs.VisionError("HTTP 500")):
            with self.assertRaises(vs.VisionError):
                vs.describe_image(p)


if __name__ == "__main__":
    unittest.main()
