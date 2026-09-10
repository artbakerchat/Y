export function createPaletteTools(palette) {
  return [
    {
      spec: {
        name: 'get_palette',
        description: 'Return the current word palette so the agent can reason about it.',
        inputSchema: { json: { type: 'object', properties: {}, required: [] } },
      },
      fn: async () => palette.length
        ? `Current palette (${palette.length} words): ${palette.join(', ')}`
        : 'The palette is empty.',
    },
    {
      spec: {
        name: 'search_palette',
        description: 'Search the palette for words matching a substring.',
        inputSchema: {
          json: {
            type: 'object',
            properties: { query: { type: 'string', description: 'Substring to search for' } },
            required: ['query'],
          },
        },
      },
      fn: async ({ query }) => {
        const q = (query || '').toLowerCase();
        const matches = palette.filter((word) => word.toLowerCase().includes(q));
        return matches.length
          ? `Found ${matches.length} match(es): ${matches.join(', ')}`
          : `No palette words match "${query}".`;
      },
    },
    {
      spec: {
        name: 'suggest_related_words',
        description: 'Suggest thematically related words that could be added to the palette.',
        inputSchema: {
          json: {
            type: 'object',
            properties: { theme: { type: 'string', description: 'The theme or concept to base suggestions on' } },
            required: ['theme'],
          },
        },
      },
      fn: async ({ theme }) => {
        const banks = {
          nature: ['glacier', 'canopy', 'driftwood', 'mesa', 'shoreline'],
          light: ['prism', 'glimmer', 'radiance', 'flicker', 'beacon'],
          motion: ['cascade', 'vortex', 'drift', 'surge', 'current'],
          time: ['epoch', 'solstice', 'twilight', 'meridian', 'cycle'],
        };
        const key = Object.keys(banks).find((name) => theme.toLowerCase().includes(name));
        const words = key ? banks[key] : ['horizon', 'ember', 'mosaic', 'compass', 'echo'];
        return `Suggested words for theme "${theme}": ${words.join(', ')}`;
      },
    },
  ];
}
