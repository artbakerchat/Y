function formatGame(game) {
  const wk = game.week ? ` (wk ${game.week})` : '';
  const matchup = `${game.away} at ${game.home} on ${game.date}${wk}`;
  return game.status === 'final'
    ? `${matchup}: ${game.away} ${game.away_score}, ${game.home} ${game.home_score}.`
    : game.status === 'in_progress'
      ? `${matchup}: in progress (${game.away_score ?? '?'}-${game.home_score ?? '?'}) at ${game.venue || 'venue not listed'}.`
      : `${matchup}: scheduled at ${game.venue || 'venue not listed'}.`;
}

/** Parse an explicit "next N" or "N games" limit from the prompt; returns null if absent. */
function parseNextLimit(lower) {
  const m = lower.match(/\bnext\s+(\d+)\b|\b(\d+)\s+(?:next\s+)?games?\b/);
  if (m) return Math.max(1, Math.min(32, parseInt(m[1] || m[2], 10)));
  if (/\bnext\s+game\b/.test(lower)) return 1;
  return null;
}

/** Parse a "week N" or "week 17" request; returns null if absent. */
function parseWeekNumber(lower) {
  const m = lower.match(/\bweek\s+(\d{1,2})\b/);
  return m ? parseInt(m[1], 10) : null;
}

export function createSportsTool(loadData) {
  return {
    spec: {
      name: 'local_sports_lookup',
      description:
        'Answer sports scores, schedules, standings, and recaps from the shared R2 sports dataset. ' +
        'Supports "next N games", "week N", and upcoming-only filters. ' +
        'Do not use memory or infer facts missing from the dataset.',
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
        const rows = data.standings
          .filter((row) => !league || String(row.league || '').toLowerCase() === league)
          .filter((row) => !teamMatches.length || teamMatches.includes(row.team));
        return rows.length
          ? rows.map((row) => `${row.league} #${row.rank} ${row.team}: ${row.points} points (${row.wins}-${row.losses}).`).join('\n')
          : 'No matching shared R2 standings record was found.';
      }

      // Week-based filter
      const weekNumber = parseWeekNumber(lower);
      if (weekNumber !== null) {
        games = games.filter((game) => Number(game.week) === weekNumber);
        if (!games.length) return `No shared R2 games found for week ${weekNumber}. This does not establish that no real-world game occurred.`;
        return games.sort((a, b) => String(a.date).localeCompare(String(b.date))).map(formatGame).join('\n');
      }

      // Next N games: filter to scheduled only, starting from today, capped at limit
      const nextLimit = parseNextLimit(lower);
      const isNextQuery = nextLimit !== null || lower.includes('next') || lower.includes('upcoming');
      const isScoreQuery = lower.includes('score') || lower.includes('result') || lower.includes('won') || lower.includes('lost');

      if (isNextQuery && !isScoreQuery) {
        const today = new Date().toISOString().slice(0, 10);
        games = games
          .filter((game) => game.status === 'scheduled' && String(game.date) >= today)
          .sort((a, b) => String(a.date).localeCompare(String(b.date)));
        if (nextLimit !== null) games = games.slice(0, nextLimit);
        if (!games.length) return 'No upcoming shared R2 scheduled games found from today onward. This does not establish that no real-world game is scheduled.';
        return games.map(formatGame).join('\n');
      }

      if (lower.includes('schedule')) {
        games = games.filter((game) => game.status === 'scheduled');
      } else if (isScoreQuery) {
        games = games.filter((game) => game.status === 'final');
      }

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
