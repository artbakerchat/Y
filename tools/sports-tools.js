export function createSportsTool(searchLive) {
  return {
    spec: {
      name: 'local_sports_lookup',
      description: 'Answer sports questions using Google and OpenAI live web search APIs. Do not use memory or infer facts missing from live results.',
      inputSchema: { json: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } },
    },
    fn: async ({ prompt }) => {
      const text = String(prompt || '').trim();
      if (!text) return 'A sports question is required.';
      const fn = typeof searchLive === 'function' ? searchLive : async () => 'Live search is unavailable.';
      return await fn(text);
    },
  };
}

export function createSportsPredictionTool(searchLive) {
  return {
    spec: {
      name: 'sports_prediction',
      description: 'Gather Google and OpenAI live search evidence for an uncertain sports forecast. Tell the user if either provider was unavailable.',
      inputSchema: { json: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    },
    fn: async ({ query }) => {
      const text = String(query || '').trim();
      if (!text) return 'A prediction query is required.';
      const fn = typeof searchLive === 'function' ? searchLive : async () => 'Live search is unavailable.';
      const live = await fn(text);
      return `PREDICTION INPUTS — NOT A VERIFIED OUTCOME\n[Google and OpenAI live search evidence]\n${live}\n\nAny conclusion must be labeled as an uncertain forecast, include assumptions, and state uncertainty.`;
    },
  };
}
