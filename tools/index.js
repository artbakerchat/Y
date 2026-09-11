import { createPaletteTools } from './palette-tools.js';
import { wordSpecialistTool } from './word-specialist-tool.js';
import { createCommunityTools } from './community-tools.js';

export function buildTools(palette, profileId = 'forge') {
  return [...createPaletteTools(palette), ...createCommunityTools(profileId), wordSpecialistTool];
}
