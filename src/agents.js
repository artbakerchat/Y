import { wordSpecialistTool } from '../tools/word-specialist-tool.js';
import profilesData from '../agentcore/profiles.js';

// Load profile definitions from the shared source of truth.
// agentcore/profiles.js is the canonical registry for all serialisable
// profile fields. Runtime-only fields (specialist function references) are
// injected here and never stored in the profile module.
const _rawProfiles = profilesData.profiles || {};

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

const ROUTING_RULES = {
  "food-bank": [["food bank", 4], ["foodbank", 4], ["pantry", 3], ["donation", 2], ["pickup window", 3], ["volunteer shift", 3]],
  "nonprofit-helpdesk": [["nonprofit", 4], ["non-profit", 4], ["grant", 3], ["bylaws", 3], ["intake form", 3], ["meeting agenda", 3], ["operating plan", 3]],
  "mutual-aid": [["mutual aid", 5], ["ride", 2], ["groceries", 2], ["check-in", 2], ["translation help", 3], ["housing navigation", 3]],
  "civic-knowledge": [["city council", 4], ["election", 3], ["government", 3], ["permit", 3], ["public service", 3], ["municipal", 3], ["voting", 3], ["civic", 3]],
  "bob-dylan": [["bob dylan", 6], ["bob", 5], ["dylan", 5], ["songwriting", 4], ["folk music", 4], ["blues", 3], ["album", 2], ["song lyrics", 3], ["music history", 3]],
  "santa-claus": [["santa claus", 6], ["santa", 6], ["christmas", 4], ["present", 3], ["presents", 3], ["gift", 3], ["gifts", 3], ["north pole", 5], ["reindeer", 4]],
  "orange-doctor-candidatus": [["orange doctor candidatus", 8], ["swipe your situation orange", 8], ["situation orange", 5], ["orange", 3], ["reframe", 3]]
};

export function inferAgentId(message, currentAgentId = "forge") {
  const text = String(message || "").toLowerCase();
  let bestId = "forge";
  let bestScore = 0;
  for (const [id, cues] of Object.entries(ROUTING_RULES)) {
    const score = cues.reduce((total, [cue, weight]) => total + (text.includes(cue) ? weight : 0), 0);
    if (score > bestScore) { bestId = id; bestScore = score; }
  }
  return bestScore >= 3 ? bestId : (currentAgentId && currentAgentId !== "forge" ? currentAgentId : "forge");
}

export function listAgentProfiles() {
  return Object.values(AGENT_PROFILES).map(({ id, name, description }) => ({ id, name, description }));
}
