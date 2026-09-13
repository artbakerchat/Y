import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app' / 'ForgeAgent'))
from answering import answer_request, needs_repair
from skill_guidance import select_skill_guidance
from forge_harness import clean_answer
from calculator import calculate
from types import SimpleNamespace
from unittest.mock import patch
import main


class AnswerQualityTests(unittest.TestCase):
    def test_empty_final_recovers_once(self):
        agent = AsyncMock()
        agent.invoke_async.side_effect = ['<thinking>internal</thinking>', 'The answer is 2.25.']
        self.assertEqual(asyncio.run(answer_request(agent, 'Divide the remaining apples.')), 'The answer is 2.25.')
        self.assertEqual(agent.invoke_async.call_count, 2)

    def test_recovery_is_bounded(self):
        agent = AsyncMock()
        agent.invoke_async.return_value = '<thinking>internal</thinking>'
        with self.assertRaises(ValueError):
            asyncio.run(answer_request(agent, 'Help.'))
        self.assertEqual(agent.invoke_async.call_count, 2)

    def test_obvious_nonanswers_and_requested_lines(self):
        self.assertTrue(needs_repair('Give exactly three ideas. One line for each.', 'No tools needed.'))
        self.assertTrue(needs_repair('Give exactly three ideas. One line for each.', 'A, B, C.'))
        self.assertFalse(needs_repair('Give exactly three ideas. One line for each.', '1. A\n2. B\n3. C'))
        self.assertTrue(needs_repair('Write an invite; the place is not yet set.', 'What is the location?'))
        self.assertFalse(needs_repair('Write an invite.', 'What is the occasion?'))

    def test_skill_scope_and_relevance(self):
        root = Path(__file__).resolve().parents[1] / 'app' / 'ForgeAgent' / 'skills'
        self.assertEqual(select_skill_guidance(root, 'forge', 'Who wrote Hallelujah?'), '')
        self.assertEqual(select_skill_guidance(root, 'bob-dylan', 'Draft a nonprofit policy.'), '')
        self.assertIn('Rewrite', select_skill_guidance(root, 'forge', 'Rewrite this sentence.').title())

    def test_answer_wrappers_and_lines(self):
        self.assertEqual(clean_answer('<answer>One.\nTwo.\nThree.</answer>'), 'One.\nTwo.\nThree.')

    def test_specialist_entrypoint_keeps_followup_context(self):
        history = [{'role': 'user', 'content': 'Explain anchor.'}, {'role': 'assistant', 'content': 'It suggests stability.'}]
        specialist = AsyncMock(return_value='That was an interpretation.')
        async def run():
            with patch.object(main, '_load_messages', return_value=history), patch.object(main, '_save_messages') as save, patch.object(main, 'run_word_specialist', specialist):
                events = [event async for event in main.invoke({'agent_id': 'word-specialist', 'prompt': 'Was that a fact?'}, SimpleNamespace(session_id='test'))]
                self.assertTrue(events)
                self.assertEqual(specialist.call_args.args[1][0]['content'][0]['text'], 'Explain anchor.')
                self.assertEqual(save.call_args.args[1][-1]['content'], 'That was an interpretation.')
        asyncio.run(run())

    def test_calculator_bounds_and_remainder(self):
        remaining = calculate('subtract', 31, 7)['result']
        self.assertEqual(calculate('divide', remaining, 5)['result'], 4.8)
        for operation, left, right in [('divide', 1, 0), ('add', True, 2), ('exec', 1, 2), ('multiply', 1e308, 1e308)]:
            with self.assertRaises(ValueError):
                calculate(operation, left, right)
