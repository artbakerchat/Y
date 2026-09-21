// Recognize explicit short word limits; regenerate rather than truncate meaning.
export function requestedWordLimit(prompt) {
  const number = '(one|two|three|four|five|six|seven|eight|nine|ten|\\d+)';
  const match = prompt.match(new RegExp(`(?:at most|no more than|just|only|exactly)\\s+${number}\\s+words?\\b`, 'i'))
    || prompt.match(new RegExp(`\\b${number}\\s+words?\\s+or\\s+(?:fewer|less)\\b`, 'i'));
  if (!match) return null;
  const value = Number(match[1]) || ['one','two','three','four','five','six','seven','eight','nine','ten'].indexOf(match[1].toLowerCase()) + 1;
  return value > 0 ? value : null;
}
export function exceedsRequestedWordLimit(prompt, answer) {
  const limit = requestedWordLimit(prompt);
  return limit !== null && answer.trim().split(/\s+/).length > limit;
}

export function requestedLineCount(prompt) {
  const match = prompt.match(/\b(?:exactly\s+|write\s+|give\s+)(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:short\s+|original\s+)?lines?\b/i);
  if (!match) return null;
  return Number(match[1]) || ['one','two','three','four','five','six','seven','eight','nine','ten'].indexOf(match[1].toLowerCase()) + 1;
}

export function formatRepairInstruction(prompt, answer) {
  const requirements = [];
  if (exceedsRequestedWordLimit(prompt, answer)) requirements.push(`at most ${requestedWordLimit(prompt)} words`);
  const lines = requestedLineCount(prompt);
  if (lines !== null && answer.trim().split(/\n/).filter(line => line.trim()).length !== lines) requirements.push(`exactly ${lines} nonempty lines separated by newline characters`);
  return requirements.length ? `Rewrite your answer using ${requirements.join(' and ')}. Fulfill the original request and retain all supplied facts. Use [place to be set] or another clear placeholder for unknown draft details. Return only the requested text, without a heading, greeting outside the draft, or explanation.` : null;
}
