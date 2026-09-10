export const wordSpecialistTool = {
  spec: {
    name: 'consult_word_specialist',
    description: 'Delegate to a specialist agent for deep word-craft advice: etymology, connotation, or poetic use of a word.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          word: { type: 'string', description: 'The word to analyse' },
          aspect: { type: 'string', description: 'Focus area: etymology | connotation | poetic_use' },
        },
        required: ['word'],
      },
    },
  },
  fn: null,
};
