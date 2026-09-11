import unittest

from forge_evals import OutputCase, OptionalStep, extract_tool_names, score_output, score_trajectory, score_trajectory_with_optional, score_branch_trajectory
from forge_trajectory import (
    FORGE_TRAJECTORIES,
    FORGE_BRANCH_TRAJECTORIES,
    evaluate_all_forge_trajectories,
    evaluate_all_forge_branch_trajectories,
    evaluate_forge_trajectory,
    evaluate_forge_branch_trajectory,
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

    # ------------------------------------------------------------------
    # Optional-step trajectory tests
    # ------------------------------------------------------------------

    def test_optional_step_passes_when_step_is_absent(self):
        """A trajectory with an optional step must pass even if the step is skipped."""
        result = score_trajectory_with_optional(
            "read-optional-search-suggest",
            ["get_palette", "suggest_related_words"],
            ["get_palette", OptionalStep("search_palette"), "suggest_related_words"],
        )
        self.assertTrue(result.passed, result.reason)

    def test_optional_step_passes_when_step_is_present(self):
        """A trajectory with an optional step must pass and score higher when present."""
        result = score_trajectory_with_optional(
            "read-optional-search-suggest",
            ["get_palette", "search_palette", "suggest_related_words"],
            ["get_palette", OptionalStep("search_palette"), "suggest_related_words"],
        )
        self.assertTrue(result.passed, result.reason)
        self.assertEqual(result.score, 1.0, "All steps satisfied should yield score 1.0")

    def test_optional_step_partial_score_when_absent(self):
        """Partial credit: optional step absent means score < 1.0."""
        result = score_trajectory_with_optional(
            "partial-optional",
            ["get_palette", "suggest_related_words"],
            ["get_palette", OptionalStep("search_palette"), "suggest_related_words"],
        )
        self.assertTrue(result.passed)
        # 2 required + 1 optional = 3 total; 2 satisfied (optional absent) = 2/3
        self.assertAlmostEqual(result.score, 2 / 3, places=5)

    def test_optional_step_fails_when_required_step_is_missing(self):
        """Optional steps do not excuse missing required steps."""
        result = score_trajectory_with_optional(
            "missing-required",
            ["search_palette", "suggest_related_words"],
            ["get_palette", OptionalStep("search_palette"), "suggest_related_words"],
        )
        self.assertFalse(result.passed, result.reason)

    # ------------------------------------------------------------------
    # Branching trajectory tests
    # ------------------------------------------------------------------

    def test_branch_trajectory_passes_on_first_branch(self):
        result = score_branch_trajectory(
            "access-then-suggest",
            ["get_palette", "suggest_related_words"],
            [
                ["get_palette", "suggest_related_words"],
                ["search_palette", "suggest_related_words"],
            ],
        )
        self.assertTrue(result.passed, result.reason)

    def test_branch_trajectory_passes_on_second_branch(self):
        result = score_branch_trajectory(
            "access-then-suggest",
            ["search_palette", "suggest_related_words"],
            [
                ["get_palette", "suggest_related_words"],
                ["search_palette", "suggest_related_words"],
            ],
        )
        self.assertTrue(result.passed, result.reason)

    def test_branch_trajectory_fails_when_no_branch_matches(self):
        result = score_branch_trajectory(
            "access-then-suggest",
            ["consult_word_specialist"],
            [
                ["get_palette", "suggest_related_words"],
                ["search_palette", "suggest_related_words"],
            ],
        )
        self.assertFalse(result.passed, result.reason)

    def test_branch_trajectory_with_optional_step_in_branch(self):
        """Optional steps inside a branch: absent optional still passes the branch."""
        result = score_branch_trajectory(
            "flexible-read-suggest",
            ["get_palette", "suggest_related_words"],
            [
                ["get_palette", OptionalStep("search_palette"), "suggest_related_words"],
                ["search_palette", "suggest_related_words"],
            ],
        )
        self.assertTrue(result.passed, result.reason)

    def test_branch_trajectory_empty_branches_fails(self):
        result = score_branch_trajectory("no-branches", ["get_palette"], [])
        self.assertFalse(result.passed)

    # ------------------------------------------------------------------
    # Registered branch trajectory contracts
    # ------------------------------------------------------------------

    def test_palette_access_branch_via_get_palette(self):
        case = FORGE_BRANCH_TRAJECTORIES[0]
        self.assertEqual(case.name, "palette-access-before-suggestion")
        result = evaluate_forge_branch_trajectory(case, [{
            "content": [
                {"toolUse": {"name": "get_palette"}},
                {"toolUse": {"name": "suggest_related_words"}},
            ],
        }])
        self.assertTrue(result.passed, result.reason)

    def test_palette_access_branch_via_search_palette(self):
        case = FORGE_BRANCH_TRAJECTORIES[0]
        result = evaluate_forge_branch_trajectory(case, [{
            "content": [
                {"toolUse": {"name": "search_palette"}},
                {"toolUse": {"name": "suggest_related_words"}},
            ],
        }])
        self.assertTrue(result.passed, result.reason)

    def test_palette_access_branch_fails_without_palette_tool(self):
        case = FORGE_BRANCH_TRAJECTORIES[0]
        result = evaluate_forge_branch_trajectory(case, [{
            "content": [
                {"toolUse": {"name": "suggest_related_words"}},
            ],
        }])
        self.assertFalse(result.passed, result.reason)

    def test_all_branch_trajectory_contracts_registered(self):
        self.assertEqual(len(FORGE_BRANCH_TRAJECTORIES), 2)

    def test_evaluate_all_forge_branch_trajectories_empty_traces(self):
        results = evaluate_all_forge_branch_trajectories({})
        self.assertEqual(len(results), len(FORGE_BRANCH_TRAJECTORIES))
        for result in results:
            self.assertFalse(result.passed, f"Empty trace should fail: {result.name}")


if __name__ == "__main__":
    unittest.main()
