import { withConversationPolicy } from '../agentcore/conversation-policy.js';

// ---------------------------------------------------------------------------
// SPORTS-SPECIFIC SEARCH
// Prompts are tailored for sports evidence: scores, schedules, standings.
// ---------------------------------------------------------------------------

export async function searchOpenAISports(query, { OPENAI_API_KEY, OPENAI_SEARCH_MODEL } = {}) {
  const apiKey = OPENAI_API_KEY?.trim();
  if (!apiKey) return 'OpenAI live search is not configured.';
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_SEARCH_MODEL || 'gpt-4.1-mini',
        instructions: withConversationPolicy('Use web search to gather current, verifiable sports evidence. Include source URLs. Distinguish evidence from uncertainty. Do not make a prediction.'),
        input: String(query || '').slice(0, 4000),
        tools: [{ type: 'web_search_preview' }],
      }),
    });
    if (!response.ok) return `OpenAI live search failed (${response.status}).`;
    const body = await response.json();
    return body.output_text
      || body.output?.flatMap((item) => item.content || []).map((item) => item.text || '').join('')
      || 'OpenAI returned no evidence.';
  } catch (error) {
    return `OpenAI live search failed: ${error instanceof Error ? error.message.slice(0, 120) : 'request error'}`;
  }
}

export async function searchGeminiSports(query, { GEMINI_API_KEY, GEMINI_SEARCH_MODEL } = {}) {
  const apiKey = GEMINI_API_KEY?.trim();
  if (!apiKey) return 'Gemini live search is not configured.';
  const model = GEMINI_SEARCH_MODEL || 'gemini-3.6-flash';
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        system_instruction: withConversationPolicy('Use Google Search grounding to gather current, verifiable sports evidence. Include source URLs. Distinguish evidence from uncertainty. Do not make a prediction.'),
        input: String(query || '').slice(0, 4000),
        tools: [{ type: 'google_search' }],
      }),
    });
    if (!response.ok) return `Gemini live search failed (${response.status}).`;
    const body = await response.json();
    // Interactions REST returns steps; output_text is an SDK convenience.
    // Read only model output, never thoughts or intermediate tool results.
    return body.steps
      ?.filter((step) => step.type === 'model_output')
      .flatMap((step) => step.content || [])
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim() || 'Gemini returned no evidence.';
  } catch (error) {
    return `Gemini live search failed: ${error instanceof Error ? error.message.slice(0, 120) : 'request error'}`;
  }
}

export async function liveSportsEvidence(query, env = {}) {
  const [openai, gemini] = await Promise.all([
    searchOpenAISports(query, env),
    searchGeminiSports(query, env),
  ]);
  const unavailable = (value) => /not configured|failed|returned no evidence/i.test(value);
  const openaiStatus = unavailable(openai) ? 'unavailable' : 'used';
  const geminiStatus = unavailable(gemini) ? 'unavailable' : 'used';
  return `PROVIDER USAGE: OpenAI live search=${openaiStatus}; Gemini Google Search=${geminiStatus}. If either provider is unavailable, tell the user which one was unavailable.\n\n[OpenAI live search]\n${openai}\n\n[Gemini Google Search]\n${gemini}`;
}

// ---------------------------------------------------------------------------
// GENERAL-PURPOSE WEB SEARCH
// Used for any real-time query: news, weather, prices, current events, etc.
// ---------------------------------------------------------------------------

export async function searchOpenAIWeb(query, { OPENAI_API_KEY, OPENAI_SEARCH_MODEL } = {}) {
  const apiKey = OPENAI_API_KEY?.trim();
  if (!apiKey) return 'OpenAI live search is not configured.';
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_SEARCH_MODEL || 'gpt-4.1-mini',
        instructions: withConversationPolicy('Use web search to find current, verifiable information. Include source URLs. Report only what the search results support. Distinguish confirmed facts from uncertainty. Do not invent information not found in the results.'),
        input: String(query || '').slice(0, 4000),
        tools: [{ type: 'web_search_preview' }],
      }),
    });
    if (!response.ok) return `OpenAI live search failed (${response.status}).`;
    const body = await response.json();
    return body.output_text
      || body.output?.flatMap((item) => item.content || []).map((item) => item.text || '').join('')
      || 'OpenAI returned no results.';
  } catch (error) {
    return `OpenAI live search failed: ${error instanceof Error ? error.message.slice(0, 120) : 'request error'}`;
  }
}

export async function searchGeminiWeb(query, { GEMINI_API_KEY, GEMINI_SEARCH_MODEL } = {}) {
  const apiKey = GEMINI_API_KEY?.trim();
  if (!apiKey) return 'Gemini live search is not configured.';
  const model = GEMINI_SEARCH_MODEL || 'gemini-3.6-flash';
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        system_instruction: withConversationPolicy('Use Google Search grounding to find current, verifiable information. Include source URLs. Report only what the search results support. Distinguish confirmed facts from uncertainty. Do not invent information not found in the results.'),
        input: String(query || '').slice(0, 4000),
        tools: [{ type: 'google_search' }],
      }),
    });
    if (!response.ok) return `Gemini live search failed (${response.status}).`;
    const body = await response.json();
    return body.steps
      ?.filter((step) => step.type === 'model_output')
      .flatMap((step) => step.content || [])
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim() || 'Gemini returned no results.';
  } catch (error) {
    return `Gemini live search failed: ${error instanceof Error ? error.message.slice(0, 120) : 'request error'}`;
  }
}

export async function liveWebEvidence(query, env = {}) {
  const [openai, gemini] = await Promise.all([
    searchOpenAIWeb(query, env),
    searchGeminiWeb(query, env),
  ]);
  const unavailable = (value) => /not configured|failed|returned no (results|evidence)/i.test(value);
  const openaiStatus = unavailable(openai) ? 'unavailable' : 'used';
  const geminiStatus = unavailable(gemini) ? 'unavailable' : 'used';
  return `PROVIDER USAGE: OpenAI live search=${openaiStatus}; Gemini Google Search=${geminiStatus}. If either provider is unavailable, tell the user which one was unavailable.\n\n[OpenAI live search]\n${openai}\n\n[Gemini Google Search]\n${gemini}`;
}
