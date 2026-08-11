import os
import unittest
from unittest import mock

import vision_server as vs


def ok_response(content="desc"):
    return {"choices": [{"message": {"content": content}}]}


class CallVisionTest(unittest.TestCase):

    def test_free_success_no_paid_call(self):
        calls = []
        def fake(url, headers, payload, timeout):
            calls.append(url)
            return ok_response("a cat")
        with mock.patch("vision_server._http_post_json", side_effect=fake):
            text = vs.call_vision(key="k", image_b64="AAAA", mime="image/jpeg",
                                  routes=[vs.FREE_ROUTE, vs.PAID_ROUTE])
        self.assertEqual(text, "a cat")
        self.assertEqual(len(calls), 1)

    def test_free_failure_falls_back_to_paid(self):
        calls = []
        def fake(url, headers, payload, timeout):
            calls.append(url)
            if url.startswith(vs.FREE_ROUTE.base_url):
                raise vs.VisionError("HTTP 500 boom")
            return ok_response("a dog")
        with mock.patch("vision_server._http_post_json", side_effect=fake):
            text = vs.call_vision(key="k", image_b64="AAAA", mime="image/jpeg",
                                  routes=[vs.FREE_ROUTE, vs.PAID_ROUTE])
        self.assertEqual(text, "a dog")
        self.assertEqual(len(calls), 2)

    def test_all_routes_fail_raises_actionable_error(self):
        def fake(url, headers, payload, timeout):
            raise vs.VisionError("HTTP 503 down")
        with mock.patch("vision_server._http_post_json", side_effect=fake):
            with self.assertRaises(vs.VisionError) as cm:
                vs.call_vision(key="k", image_b64="AAAA", mime="image/jpeg",
                               routes=[vs.FREE_ROUTE, vs.PAID_ROUTE])
        self.assertIn("所有线路", str(cm.exception))

    def test_401_hints_at_key_setup(self):
        def fake(url, headers, payload, timeout):
            raise vs.VisionError("HTTP 401 unauthorized")
        with mock.patch("vision_server._http_post_json", side_effect=fake):
            with self.assertRaises(vs.VisionError) as cm:
                vs.call_vision(key="k", image_b64="AAAA", mime="image/jpeg",
                               routes=[vs.FREE_ROUTE, vs.PAID_ROUTE])
        self.assertIn("MIMO_VISION_API_KEY", str(cm.exception))

    def test_paid_disabled_single_route_single_call(self):
        calls = []
        def fake(url, headers, payload, timeout):
            calls.append(url)
            raise vs.VisionError("HTTP 500 boom")
        routes, _ = vs.resolve_routes(environ={"MIMO_VISION_ALLOW_PAID": "false"})
        with mock.patch("vision_server._http_post_json", side_effect=fake):
            with self.assertRaises(vs.VisionError):
                vs.call_vision(key="k", image_b64="AAAA", mime="image/jpeg", routes=routes)
        self.assertEqual(len(calls), 1)

    def test_payload_includes_image_and_question(self):
        seen = {}
        def fake(url, headers, payload, timeout):
            seen.update(payload)
            return ok_response("x")
        with mock.patch("vision_server._http_post_json", side_effect=fake):
            vs.call_vision(key="k", image_b64="QUJD", mime="image/png",
                           question="what color?", routes=[vs.FREE_ROUTE])
        msg = seen["messages"][0]
        parts = msg["content"]
        self.assertEqual(parts[0]["text"], "what color?")
        self.assertEqual(parts[1]["image_url"]["url"], "data:image/png;base64,QUJD")
        self.assertEqual(seen["model"], vs.FREE_ROUTE.model)

    def test_list_content_extracted(self):
        def fake(url, headers, payload, timeout):
            return {"choices": [{"message": {"content": [
                {"type": "text", "text": "part1"}, {"type": "text", "text": "part2"}]}}]}
        with mock.patch("vision_server._http_post_json", side_effect=fake):
            text = vs.call_vision(key="k", image_b64="AAAA", mime="image/jpeg",
                                  routes=[vs.FREE_ROUTE])
        self.assertEqual(text, "part1part2")

    def test_any_401_triggers_key_hint(self):
        # free -> 401, paid -> 500: hint must still be actionable
        def fake(url, headers, payload, timeout):
            if url.startswith(vs.FREE_ROUTE.base_url):
                raise vs.VisionError("HTTP 401 unauthorized")
            raise vs.VisionError("HTTP 500 boom")
        with mock.patch("vision_server._http_post_json", side_effect=fake):
            with self.assertRaises(vs.VisionError) as cm:
                vs.call_vision(key="k", image_b64="AAAA", mime="image/jpeg",
                               routes=[vs.FREE_ROUTE, vs.PAID_ROUTE])
        self.assertIn("MIMO_VISION_API_KEY", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
