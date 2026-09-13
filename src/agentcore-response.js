// AgentCore Python entrypoints may emit SSE or a single JSON response.
export async function readAgentCoreResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('AgentCore returned an empty body');
  const decoder = new TextDecoder();
  let size = 0;
  let raw = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 128 * 1024) {
        await reader.cancel();
        throw new Error('AgentCore response exceeded size limit');
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  if (!response.ok) throw new Error(`AgentCore request failed (${response.status})`);
  const textFrom = (value) => value?.event?.contentBlockDelta?.delta?.text
    || value?.output?.message?.content?.map((part) => part.text || '').join('')
    || value?.result?.content?.map((part) => part.text || '').join('')
    || value?.response || value?.text || (typeof value?.output === 'string' ? value.output : '');
  const frames = raw.split(/\r?\n\r?\n/).map((frame) => frame.split(/\r?\n/)
    .filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')).filter(Boolean);
  const answer = frames.length
    ? frames.filter((frame) => frame !== '[DONE]').map((frame) => textFrom(JSON.parse(frame))).join('')
    : textFrom(JSON.parse(raw));
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('AgentCore returned no answer');
  return answer;
}
