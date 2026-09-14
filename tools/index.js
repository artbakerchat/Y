import { createPaletteTools } from './palette-tools.js';
import { wordSpecialistTool } from './word-specialist-tool.js';
import { createCommunityTools } from './community-tools.js';
import { calculatorTool } from './calculator.js';
import { createSportsPredictionTool, createSportsTool } from './sports-tools.js';

export function buildTools(palette, profileId = 'forge', options = {}) {
  const tools = [...createPaletteTools(palette), ...createCommunityTools(profileId), wordSpecialistTool, calculatorTool];
  tools.push(createSportsTool(options.loadSportsData || (async () => null)));
  tools.push(createSportsPredictionTool(options.loadSportsData || (async () => null), options.searchLive || (async () => 'Live sports search is unavailable.')));
  return tools;
}
