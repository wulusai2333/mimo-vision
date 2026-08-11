import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

import vision_server as vs


def write_tmp(data=b"raw-image-bytes", name="photo.png"):
    d = tempfile.mkdtemp()
    p = os.path.join(d, name)
    with open(p, "wb") as f:
        f.write(data)
    return p


class PreprocessImageTest(unittest.TestCase):

    def test_magick_preferred_and_command_built(self):
        p = write_tmp()
        seen = {}
        def fake_run(args, **kwargs):
            seen["args"] = args
            with open(args[-1], "wb") as f:
                f.write(b"jpeg-bytes")
            return SimpleNamespace(returncode=0, stderr=b"")
        with mock.patch.object(vs.shutil, "which",
                               side_effect=lambda name: "/usr/bin/magick" if name == "magick" else None), \
             mock.patch.object(vs.subprocess, "run", side_effect=fake_run):
            data, mime = vs.preprocess_image(p)
        self.assertEqual(data, b"jpeg-bytes")
        self.assertEqual(mime, "image/jpeg")
        args = seen["args"]
        self.assertEqual(args[0], "/usr/bin/magick")
        self.assertIn("-resize", args)
        self.assertIn("2048x2048>", args)
        self.assertIn("-quality", args)
        self.assertIn("85", args)
        self.assertIn("-strip", args)

    def test_system32_convert_excluded(self):
        p = write_tmp()
        calls = []
        def fake_run(args, **kwargs):
            calls.append(args)
            return SimpleNamespace(returncode=0, stderr=b"")
        def fake_which(name):
            if name == "magick":
                return None
            if name == "convert":
                return "C:\\Windows\\System32\\convert.exe"
            return None
        with mock.patch.object(vs.shutil, "which", side_effect=fake_which), \
             mock.patch.object(vs.subprocess, "run", side_effect=fake_run):
            data, mime = vs.preprocess_image(p)
        self.assertEqual(data, b"raw-image-bytes")
        self.assertEqual(mime, "image/png")
        self.assertEqual(calls, [])

    def test_non_system32_convert_used(self):
        p = write_tmp()
        seen = {}
        def fake_run(args, **kwargs):
            seen["args"] = args
            with open(args[-1], "wb") as f:
                f.write(b"jpeg-bytes")
            return SimpleNamespace(returncode=0, stderr=b"")
        def fake_which(name):
            return None if name == "magick" else "C:\\tools\\convert.exe"
        with mock.patch.object(vs.shutil, "which", side_effect=fake_which), \
             mock.patch.object(vs.subprocess, "run", side_effect=fake_run):
            data, mime = vs.preprocess_image(p)
        self.assertEqual(seen["args"][0], "C:\\tools\\convert.exe")

    def test_no_tool_raw_passthrough(self):
        p = write_tmp(b"\x89PNG...", "a.webp")
        with mock.patch.object(vs.shutil, "which", return_value=None):
            data, mime = vs.preprocess_image(p)
        self.assertEqual(data, b"\x89PNG...")
        self.assertEqual(mime, "image/webp")

    def test_im_failure_raises(self):
        p = write_tmp()
        def fake_run(args, **kwargs):
            return SimpleNamespace(returncode=1, stderr=b"boom")
        with mock.patch.object(vs.shutil, "which", return_value="/usr/bin/magick"), \
             mock.patch.object(vs.subprocess, "run", side_effect=fake_run):
            with self.assertRaises(vs.VisionError):
                vs.preprocess_image(p)

    def test_missing_file_raises(self):
        with self.assertRaises(vs.VisionError):
            vs.preprocess_image(os.path.join(tempfile.gettempdir(), "nope_missing_123.png"))


if __name__ == "__main__":
    unittest.main()
