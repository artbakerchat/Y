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
  const textFrom = (value) => {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';
    if (Array.isArray(value)) return value.map(textFrom).join('');
    const direct = value.event?.contentBlockDelta?.delta?.text
      || value.contentBlockDelta?.delta?.text
      || value.chunk?.contentBlockDelta?.delta?.text
      || value.output?.message?.content?.map((part) => part.text || '').join('')
      || value.result?.content?.map((part) => part.text || '').join('')
      || value.content?.map((part) => part.text || '').join('')
      || value.answer
      || value.text;
    if (typeof direct === 'string' && direct.trim()) return direct;
    return textFrom(value.response) || textFrom(value.output) || textFrom(value.result);
  };
  const frames = raw.split(/\r?\n\r?\n/).map((frame) => frame.split(/\r?\n/)
    .filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')).filter(Boolean);
  let payloads;
  if (frames.length) {
    payloads = frames.filter((frame) => frame !== '[DONE]').map((frame) => JSON.parse(frame));
  } else {
    try {
      payloads = [JSON.parse(raw)];
    } catch {
      const dataLines = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart());
      payloads = (dataLines.length ? dataLines : raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
        .filter((line) => line !== '[DONE]').map((line) => JSON.parse(line));
    }
  }
  const answer = payloads.map(textFrom).join('');
  const upstreamError = payloads.find((value) => value && typeof value === 'object' && (value.error || value.error_type));
  if (upstreamError) {
    const message = typeof upstreamError.message === 'string' ? upstreamError.message.slice(0, 240) : 'unknown runtime error';
    throw new Error(`AgentCore runtime error: ${message}`);
  }
  if (typeof answer !== 'string' || !answer.trim()) {
    const shape = payloads.slice(0, 3).map((value) => Array.isArray(value) ? 'array' : value && typeof value === 'object' ? Object.keys(value).slice(0, 8).join(',') : typeof value).join('|');
    throw new Error(`AgentCore returned no answer (content-type=${response.headers.get('content-type') || 'unknown'}; bytes=${size}; shape=${shape || 'empty'})`);
  }
  return answer;
}
