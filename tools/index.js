import { createPaletteTools } from './palette-tools.js';
import { wordSpecialistTool } from './word-specialist-tool.js';

export function buildTools(palette) {
  return [...createPaletteTools(palette), wordSpecialistTool];
}
