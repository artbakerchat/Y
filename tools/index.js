import { createPaletteTools } from './palette-tools.js';
import { wordSpecialistTool } from './word-specialist-tool.js';
import { createCommunityTools } from './community-tools.js';
import { calculatorTool } from './calculator.js';
import { createSportsPredictionTool, createSportsTool, createWebSearchTool } from './sports-tools.js';
import { createWeatherTool } from './weather-tools.js';
import { createBeeMemoryTools } from './bee-memory-tools.js';

// Bee memory tools spawn Python subprocesses, which only exist on the
// Node.js server. The Cloudflare Worker bundles this module too, so gate
// registration on a real Node runtime and keep the Worker's tool allow-list
// free of tools that could never run there.
const isNodeRuntime =
  typeof process !== 'undefined' && !!process?.versions?.node;

export function buildTools(palette, profileId = 'forge', options = {}) {
  const searchLive = options.searchLive || (async () => 'Live search is unavailable.');
  const searchLiveWeb = options.searchLiveWeb || searchLive;
  const tools = [...createPaletteTools(palette), ...createCommunityTools(profileId), wordSpecialistTool, calculatorTool];
  tools.push(createSportsTool(searchLive));
  tools.push(createSportsPredictionTool(searchLive));
  tools.push(createWebSearchTool(searchLiveWeb));
  tools.push(createWeatherTool(searchLiveWeb));
  if (isNodeRuntime) tools.push(...createBeeMemoryTools());
  return tools;
}
