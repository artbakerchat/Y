import { createPaletteTools } from './palette-tools.js';
import { wordSpecialistTool } from './word-specialist-tool.js';
import { createCommunityTools } from './community-tools.js';
import { calculatorTool } from './calculator.js';
import { createSportsPredictionTool, createSportsTool } from './sports-tools.js';

export function buildTools(palette, profileId = 'forge', options = {}) {
  const searchLive = options.searchLive || (async () => 'Live search is unavailable.');
  const tools = [...createPaletteTools(palette), ...createCommunityTools(profileId), wordSpecialistTool, calculatorTool];
  tools.push(createSportsTool(searchLive));
  tools.push(createSportsPredictionTool(searchLive));
  return tools;
}
