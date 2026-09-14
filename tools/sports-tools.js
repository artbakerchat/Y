function formatGame(game) {
  const matchup = `${game.away} at ${game.home} on ${game.date}`;
  return game.status === 'final'
    ? `${matchup}: ${game.away} ${game.away_score}, ${game.home} ${game.home_score}.`
    : `${matchup}: scheduled at ${game.venue || 'venue not listed'}.`;
}

export function createSportsTool(loadData) {
  return {
    spec: {
      name: 'local_sports_lookup',
      description: 'Answer sports scores, schedules, standings, and recaps from the shared R2 sports dataset. Do not use memory or infer facts missing from the dataset.',
      inputSchema: { json: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } },
    },
    fn: async ({ prompt }) => {
      const data = await loadData();
      if (!data) return 'The shared R2 sports dataset is unavailable.';
      const text = String(prompt || '').trim();
      if (!text) return 'A sports question is required.';
      const lower = text.toLowerCase();
      const league = ['nhl', 'mls', 'nba', 'nfl', 'wnba', 'mlb'].find((name) => lower.includes(name));
      const words = new Set(lower.match(/[a-z0-9]+/g) || []);
      const teamMatches = [...new Set(data.games.flatMap((game) => [game.away, game.home]).filter(Boolean))]
        .filter((team) => (String(team).toLowerCase().match(/[a-z0-9]+/g) || []).some((word) => word.length > 3 && words.has(word)));
      let games = data.games.filter((game) => !league || String(game.league || '').toLowerCase() === league);
      if (teamMatches.length) games = games.filter((game) => teamMatches.includes(game.away) || teamMatches.includes(game.home));
      if (lower.includes('standing') || lower.includes('table') || lower.includes('rank') || lower.includes('record')) {
        const rows = data.standings.filter((row) => !league || String(row.league || '').toLowerCase() === league)
          .filter((row) => !teamMatches.length || teamMatches.includes(row.team));
        return rows.length ? rows.map((row) => `${row.league} #${row.rank} ${row.team}: ${row.points} points (${row.wins}-${row.losses}).`).join('\n') : 'No matching shared R2 standings record was found.';
      }
      if (lower.includes('next') || lower.includes('upcoming') || lower.includes('schedule')) games = games.filter((game) => game.status === 'scheduled');
      else if (lower.includes('score') || lower.includes('result') || lower.includes('won') || lower.includes('lost')) games = games.filter((game) => game.status === 'final');
      if (games.length) return games.sort((a, b) => String(a.date).localeCompare(String(b.date))).map(formatGame).join('\n');
      return 'No matching shared R2 game record was found. This does not establish that no real-world game occurred.';
    },
  };
}

export function createSportsPredictionTool(loadData, searchLive) {
  return {
    spec: {
      name: 'sports_prediction',
      description: 'Combine the shared R2 sports dataset with supplemental OpenAI and Gemini web evidence for an uncertain sports forecast. Local R2 data has priority; live evidence is supplemental. Tell the user if either provider was unavailable.',
      inputSchema: { json: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    },
    fn: async ({ query }) => {
      const data = await loadData();
      if (!data) return 'The shared R2 sports dataset is unavailable; no forecast should be made.';
      const live = await searchLive(String(query || '').trim());
      return `PREDICTION INPUTS — NOT A VERIFIED OUTCOME\n[Local R2 JSON — priority source]\n${JSON.stringify(data)}\n\n[Supplemental live evidence]\n${live}\n\nAny conclusion must be labeled as an uncertain forecast, include assumptions, and state uncertainty.`;
    },
  };
}
