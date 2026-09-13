import test from 'node:test';
import assert from 'node:assert/strict';
import { specializedQuestions } from '../scripts/specialized-questions.js';
import { specializedHoldout } from '../scripts/specialized-holdout.js';
import { createCommunityTools } from '../tools/community-tools.js';
import { requestedLineCount } from '../src/answer-format.js';
import { createAgentHarness } from '../src/agent-harness.js';

test('nine specialist suites each have ten specialized and five shared public-size prompts', () => {
  assert.equal(Object.keys(specializedQuestions).length, 9);
  for (const cases of Object.values(specializedQuestions)) {
    assert.equal(cases.length, 15);
    assert.equal(cases.filter(q => q.id.startsWith('specialist')).length, 10);
    assert.equal(new Set(cases.map(q => q.id)).size, 15);
  }
  assert.equal(specializedHoldout.length, 15);
  for (const q of [...Object.values(specializedQuestions).flat(), ...specializedHoldout]) {
    assert.ok(q.rubric);
    assert.ok(q.prompt.split(/\s+/).length <= 52, q.prompt);
    assert.ok(q.prompt.split(/\s+/).every(word => word.length <= 16), q.prompt);
  }
});

test('civic tool cannot elevate supplied flags, suffixes, or deceptive URLs into evidence', async () => {
  const tool = createCommunityTools('civic-knowledge')[0];
  for (const url of ['https://example.org/', 'https://city.gov/', 'https://evil.test/city.gov/', 'https://school.edu/', 'https://www.canada.ca/']) {
    const result = JSON.parse(await tool.fn({ sources: [{ url, verified: true }] }));
    assert.equal(result.grounded, false);
    assert.equal(result.sources[0].verified, false);
    assert.equal(result.sources[0].claimedVerified, true);
  }
});

test('unsupported nonprofit templates do not silently become grant trackers', async () => {
  const tool = createCommunityTools('nonprofit-helpdesk')[0];
  const result = await tool.fn({ templateType: 'birthday card' });
  assert.match(result, /Draft the requested text directly/);
  assert.doesNotMatch(result, /Grant Tracker/);
});

test('line repair retains original task and requests a bounded second attempt', async () => {
  assert.equal(requestedLineCount('Write exactly three short lines.'), 3);
  assert.equal(requestedLineCount('Give three apples.'), null);
  let calls = 0;
  const run = createAgentHarness({ modelId: 'test', converse: async input => {
    const text = calls++ ? 'Dear Jo,\nJoin the walk Monday.\nPlace: [to be set]' : 'Join a walk.';
    if (calls === 2) {
      assert.match(input.messages.at(-1).content[0].text, /exactly 3 nonempty lines/);
      assert.match(input.messages[0].content[0].text, /Jo/);
    }
    return { stopReason: 'end_turn', output: { message: { role: 'assistant', content: [{ text }] } } };
  }});
  const result = await run({ prompt: 'Write exactly three short lines inviting Jo to a walk Monday. Place is unknown.' });
  assert.equal(calls, 2);
  assert.equal(result.answer.split('\n').length, 3);
});
