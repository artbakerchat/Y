// Preserve meaningful formatting while enforcing the public response contract.
export function cleanAnswer(value) {
  const text = String(value ?? '')
    .replace(/<(think|thinking|analysis)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(think|thinking|analysis)\b[^>]*>[\s\S]*$/gi, '')
    .replace(/<\/?(?:answer|final|response)\b[^>]*>/gi, '').trim();
  if (!text) throw new Error('Model returned no text');
  const words = [...text.matchAll(/\S+/g)];
  if (words.length <= 52) return text;
  const bounded = text.slice(0, words[51].index + words[51][0].length);
  const endings = [...bounded.matchAll(/[.!?](?:\s|$)/g)];
  const end = endings.at(-1);
  if (end && bounded.slice(0, end.index + 1).split(/\s+/).length >= 8) return bounded.slice(0, end.index + 1);
  return bounded + '…';
}
