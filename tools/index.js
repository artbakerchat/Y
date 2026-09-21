import { createPaletteTools } from './palette-tools.js';
import { wordSpecialistTool } from './word-specialist-tool.js';
import { createCommunityTools } from './community-tools.js';
import { calculatorTool } from './calculator.js';
import { createSportsPredictionTool, createSportsTool, createWebSearchTool } from './sports-tools.js';
import { createWeatherTool } from './weather-tools.js';

export function buildTools(palette, profileId = 'forge', options = {}) {
  const searchLive = options.searchLive || (async () => 'Live search is unavailable.');
  const searchLiveWeb = options.searchLiveWeb || searchLive;
  const tools = [...createPaletteTools(palette), ...createCommunityTools(profileId), wordSpecialistTool, calculatorTool];
  tools.push(createSportsTool(searchLive));
  tools.push(createSportsPredictionTool(searchLive));
  tools.push(createWebSearchTool(searchLiveWeb));
  tools.push(createWeatherTool(searchLiveWeb));
  return tools;
}
