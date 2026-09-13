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
