import unittest

from forge_evals import OutputCase, extract_tool_names, score_output, score_trajectory
from forge_trajectory import (
    FORGE_TRAJECTORIES,
    evaluate_all_forge_trajectories,
    evaluate_forge_trajectory,
)


class ForgeEvalTests(unittest.TestCase):
    def test_output_contract_checks_required_and_forbidden_content(self):
        result = score_output(OutputCase(
            name="technical-answer",
            response="Reset the headphones, then pair them again.",
            required_fragments=("headphones", "pair"),
            forbidden_fragments=("guarantee",),
        ))
        self.assertTrue(result.passed)
        self.assertEqual(result.score, 1.0)

    def test_trajectory_allows_extra_tools_but_preserves_order(self):
        actual = ["lookup_customer", "search_palette", "get_order_history", "process_refund"]
        result = score_trajectory(
            "refund-workflow",
            actual,
            ["lookup_customer", "get_order_history", "process_refund"],
        )
        self.assertTrue(result.passed)

    def test_trajectory_rejects_wrong_order(self):
        result = score_trajectory(
            "refund-workflow",
            ["process_refund", "lookup_customer", "get_order_history"],
            ["lookup_customer", "get_order_history", "process_refund"],
        )
        self.assertFalse(result.passed)

    def test_extract_tool_names_from_agent_messages(self):
        messages = [{
            "role": "assistant",
            "content": [
                {"text": "I will check that."},
                {"toolUse": {"name": "lookup_customer", "input": {"customer_id": "C-1001"}}},
            ],
        }]
        self.assertEqual(extract_tool_names(messages), ["lookup_customer"])

    def test_current_forge_palette_trajectory(self):
        case = FORGE_TRAJECTORIES[0]
        result = evaluate_forge_trajectory(case, [{
            "role": "assistant",
            "content": [
                {"toolUse": {"name": "get_palette", "input": {}}},
            ],
        }, {
            "role": "assistant",
            "content": [
                {"toolUse": {"name": "suggest_related_words", "input": {"theme": "light"}}},
            ],
        }])
        self.assertTrue(result.passed, result.reason)

    def test_current_forge_trajectory_rejects_suggesting_before_reading(self):
        case = FORGE_TRAJECTORIES[0]
        result = evaluate_forge_trajectory(case, [{
            "role": "assistant",
            "content": [{"toolUse": {"name": "suggest_related_words", "input": {}}}],
        }, {
            "role": "assistant",
            "content": [{"toolUse": {"name": "get_palette", "input": {}}}],
        }])
        self.assertFalse(result.passed)

    def test_all_current_forge_trajectories_require_recorded_traces(self):
        traces = {
            "palette-suggestion-after-read": [{"content": [
                {"toolUse": {"name": "get_palette"}},
                {"toolUse": {"name": "suggest_related_words"}},
            ]}],
            "palette-search-then-suggestion": [{"content": [
                {"toolUse": {"name": "search_palette"}},
                {"toolUse": {"name": "suggest_related_words"}},
            ]}],
            "word-specialist-delegation": [{"content": [
                {"toolUse": {"name": "consult_word_specialist"}},
            ]}],
        }
        results = evaluate_all_forge_trajectories(traces)
        self.assertEqual(len(results), 3)
        self.assertTrue(all(result.passed for result in results))
        self.assertFalse(evaluate_all_forge_trajectories({})[0].passed)


if __name__ == "__main__":
    unittest.main()
