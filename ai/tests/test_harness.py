import unittest

from ai.harness import AGENTS, get_agent, main, validate_fleet


class HarnessTests(unittest.TestCase):
    def test_registry_is_valid(self):
        self.assertEqual(validate_fleet(), [])
        self.assertEqual(set(AGENTS), {"agy", "kiro", "codex"})

    def test_list_is_dependency_light(self):
        self.assertEqual(main(["--list"]), 0)

    def test_unknown_agent_is_rejected(self):
        with self.assertRaises(ValueError):
            get_agent("missing")


if __name__ == "__main__":
    unittest.main()
