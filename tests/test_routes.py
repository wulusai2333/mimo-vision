import os
import unittest

import vision_server as vs


class ResolveRoutesTest(unittest.TestCase):

    def test_default_free_then_paid(self):
        routes, explicit = vs.resolve_routes(environ={})
        self.assertFalse(explicit)
        self.assertEqual([(r.label, r.base_url, r.model) for r in routes], [
            ("free", "https://opencode.ai/zen/v1", "mimo-v2.5-free"),
            ("paid", "https://opencode.ai/zen/go/v1", "mimo-v2.5"),
        ])

    def test_allow_paid_false_disables_paid(self):
        routes, explicit = vs.resolve_routes(environ={"MIMO_VISION_ALLOW_PAID": "false"})
        self.assertEqual([r.label for r in routes], ["free"])

    def test_allow_paid_zero_disables_paid(self):
        routes, explicit = vs.resolve_routes(environ={"MIMO_VISION_ALLOW_PAID": "0"})
        self.assertEqual([r.label for r in routes], ["free"])

    def test_base_url_override_explicit_single_route(self):
        routes, explicit = vs.resolve_routes(environ={"MIMO_VISION_BASE_URL": "https://example.com/v1"})
        self.assertTrue(explicit)
        self.assertEqual(len(routes), 1)
        self.assertEqual(routes[0].base_url, "https://example.com/v1")
        self.assertEqual(routes[0].model, "mimo-v2.5-free")

    def test_model_override_explicit_single_route(self):
        routes, explicit = vs.resolve_routes(environ={"MIMO_VISION_MODEL": "my-model"})
        self.assertTrue(explicit)
        self.assertEqual(len(routes), 1)
        self.assertEqual(routes[0].base_url, "https://opencode.ai/zen/v1")
        self.assertEqual(routes[0].model, "my-model")

    def test_both_overrides(self):
        routes, explicit = vs.resolve_routes(environ={
            "MIMO_VISION_BASE_URL": "https://example.com/v1", "MIMO_VISION_MODEL": "my-model"})
        self.assertTrue(explicit)
        self.assertEqual(routes[0].base_url, "https://example.com/v1")
        self.assertEqual(routes[0].model, "my-model")

    def test_empty_allow_paid_defaults_true(self):
        routes, explicit = vs.resolve_routes(environ={"MIMO_VISION_ALLOW_PAID": ""})
        self.assertEqual([r.label for r in routes], ["free", "paid"])


if __name__ == "__main__":
    unittest.main()
