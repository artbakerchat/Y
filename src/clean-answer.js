// Remove internal wrappers without deleting content needed for a complete answer.
export function cleanAnswer(value) {
  const text = String(value ?? '')
    .replace(/<(think|thinking|analysis)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(think|thinking|analysis)\b[^>]*>[\s\S]*$/gi, '')
    .replace(/<\/?(?:answer|final|response)\b[^>]*>/gi, '').trim();
  if (!text) throw new Error('Model returned no text');
  return text;
}
