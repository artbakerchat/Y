import { wordSpecialistTool } from '../tools/word-specialist-tool.js';

export const AGENT_PROFILES = {
  forge: {
    id: 'forge',
    name: 'Forge',
    description: 'A focused word specialist and conversation partner.',
    systemPrompt: 'Help the user explore meaning, nuance, connotation, etymology, tone, and poetic or precise word choice. Stay tightly on the user\'s topic; do not drift into generic life coaching or broad brainstorming. Use plain language, give concrete examples when useful, and ask at most one concise follow-up question when needed.',
    toolNames: ['get_palette', 'search_palette', 'suggest_related_words', 'consult_word_specialist'],
    skillNames: ['palette-building', 'word-exploration', 'conversation-style'],
    dailyRequestLimit: 8,
    maxToolCallsPerRequest: 3,
    specialist: wordSpecialistTool,
  },
};

export function getAgentProfile(id = 'forge') {
  return AGENT_PROFILES[id] || null;
}

export function listAgentProfiles() {
  return Object.values(AGENT_PROFILES).map(({ id, name, description }) => ({ id, name, description }));
}