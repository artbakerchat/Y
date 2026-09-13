import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app" / "ForgeAgent"))
import main
from forge_harness import HarnessHook, RequestBudget, request_budget, clean_answer
from forge_profiles import get_profile


PROFILES = ["forge", "food-bank", "nonprofit-helpdesk", "mutual-aid", "civic-knowledge", "bob-dylan", "santa-claus", "orange-doctor-candidatus"]


class HarnessTests(unittest.TestCase):
    def test_all_profiles_have_tools_model_and_role(self):
        for profile_id in PROFILES:
            with self.subTest(profile=profile_id):
                agent = main._agent_for_palette([], 8, "test-session", profile_id)
                self.assertIn(get_profile(profile_id)["systemPrompt"], agent.system_prompt)
                self.assertEqual(set(agent.tool_names) - {"skills"}, set(get_profile(profile_id)["toolNames"]))
                self.assertEqual(agent.model.config["model_id"], "ca.amazon.nova-lite-v1:0")

    def test_shared_parent_and_specialist_budget(self):
        token = request_budget.set(RequestBudget())
        try:
            parent, child = HarnessHook("forge"), HarnessHook("word-specialist")
            for _ in range(5):
                parent.before_model(None)
                child.before_model(None)
            with self.assertRaisesRegex(RuntimeError, "Model call budget"):
                child.before_model(None)
        finally:
            request_budget.reset(token)

    def test_invented_records_blocked(self):
        token = request_budget.set(RequestBudget())
        try:
            event = SimpleNamespace(tool_use={"name": "match_food_bank_shifts", "input": {"name": "Invented"}}, cancel_tool=False)
            HarnessHook("food-bank", "two volunteers").before_tool(event)
            self.assertTrue(event.cancel_tool)
        finally:
            request_budget.reset(token)

    def test_clean_answer(self):
        self.assertEqual(clean_answer("<thinking>hidden</thinking>Hello."), "Hello.")
        self.assertEqual(len(clean_answer("word " * 70).split()), 52)
        self.assertEqual(clean_answer("This complete opening sentence has enough useful words. " + "word " * 70), "This complete opening sentence has enough useful words.")
        with self.assertRaises(ValueError):
            clean_answer("<thinking>hidden</thinking>")

    def test_unknown_profile_rejected(self):
        with self.assertRaises(ValueError):
            main._profile_id_from({"agent_id": "unknown"})

    def test_stream_contract_and_profile_isolation(self):
        async def exercise():
            sessions = []
            class FakeAgent:
                messages = []
                async def invoke_async(self, prompt):
                    return "<thinking>hidden</thinking>A useful answer."
            def build(palette, remaining, session_id, *args):
                sessions.append(session_id)
                return FakeAgent()
            with patch.object(main, "_agent_for_palette", side_effect=build), patch.object(main, "_load_messages", return_value=[]), patch.object(main, "_save_messages"), patch.object(main, "_load_palette", return_value=[]):
                for profile_id in ["forge", "food-bank"]:
                    events = [event async for event in main.invoke({"prompt": "Help", "agent_id": profile_id, "requests_remaining": 0}, SimpleNamespace(session_id="same-user-session"))]
                    self.assertEqual(events[0]["event"]["contentBlockDelta"]["delta"]["text"], "A useful answer.")
            self.assertNotEqual(sessions[0], sessions[1])
            self.assertIsNone(request_budget.get())
        asyncio.run(exercise())


if __name__ == "__main__":
    unittest.main()
