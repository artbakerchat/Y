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

/**
 * General-purpose real-time web search tool.
 * Accepts a separate searchLiveWeb function so sports and general search
 * can use different prompts while sharing the same provider infrastructure.
 */
export function createWebSearchTool(searchLiveWeb) {
  return {
    spec: {
      name: 'web_search',
      description: 'Search the web for current information: news, weather, prices, events, or any real-time query. Use this tool whenever the question requires up-to-date information beyond training data. Do not invent results not found in the search response.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query. Be specific and include relevant context (dates, locations, names).',
            },
          },
          required: ['query'],
        },
      },
    },
    fn: async ({ query }) => {
      const text = String(query || '').trim();
      if (!text) return 'A search query is required.';
      const fn = typeof searchLiveWeb === 'function' ? searchLiveWeb : async () => 'Live web search is unavailable.';
      return await fn(text);
    },
  };
}
