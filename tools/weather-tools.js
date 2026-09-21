function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function createWeatherTool(searchLiveWeb) {
  return {
    spec: {
      name: 'weather_lookup',
      description: 'Find current weather or a forecast for a user-supplied location. Use this for live weather rather than memory.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'City, region, or address area for the forecast.' },
            date: { type: 'string', description: 'Optional date or range such as today, tomorrow, or this week.' },
          },
          required: ['location'],
        },
      },
    },
    fn: async ({ location, date = 'today' } = {}) => {
      const place = text(location);
      if (!place) return 'A location is required for a weather lookup.';
      const when = text(date) || 'today';
      const query = `Current weather and forecast for ${place} ${when}`;
      const search = typeof searchLiveWeb === 'function'
        ? searchLiveWeb
        : async () => 'Live weather search is unavailable.';
      return await search(query);
    },
  };
}
