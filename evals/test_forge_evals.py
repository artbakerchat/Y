import unittest

from forge_evals import OutputCase, extract_tool_names, score_output, score_trajectory


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


if __name__ == "__main__":
    unittest.main()