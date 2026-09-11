import { createRequire } from 'module';
import { wordSpecialistTool } from '../tools/word-specialist-tool.js';

// Load profile definitions from the shared source of truth.
// agentcore/profiles.json is the canonical registry for all serialisable
// profile fields. Runtime-only fields (specialist function references) are
// injected here and never stored in the JSON file.
const require = createRequire(import.meta.url);
const _profilesData = require('../agentcore/profiles.json');
const _rawProfiles = _profilesData.profiles || {};

// Map specialist string keys to live tool objects. Add new entries here
// when new specialist tools are introduced.
const SPECIALIST_MAP = {
  word_specialist: wordSpecialistTool,
};

// Enrich each profile from JSON with its runtime specialist reference.
export const AGENT_PROFILES = Object.fromEntries(
  Object.entries(_rawProfiles).map(([id, profile]) => [
    id,
    {
      ...profile,
      specialist: SPECIALIST_MAP[profile.specialist] ?? null,
    },
  ])
);

export function getAgentProfile(id = 'forge') {
  return AGENT_PROFILES[id] || null;
}

export function listAgentProfiles() {
  return Object.values(AGENT_PROFILES).map(({ id, name, description }) => ({ id, name, description }));
}
