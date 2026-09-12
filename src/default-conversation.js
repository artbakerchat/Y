// Backend-owned welcome conversation shown to every new workspace session.
export const DEFAULT_APPLE_CONVERSATION = [
  { role: 'user', content: 'How many apples can I get from the food bank?' },
  {
    role: 'assistant',
    content:
      'Would you like to confirm the default serving plan of one apple per person, or do you have any specific needs or preferences for the food bank distribution?',
  },
  { role: 'user', content: '3 people' },
  {
    role: 'assistant',
    content:
      'You can get three apples from the food bank, with one apple per person. Is there anything else you would like to know or plan regarding the food bank distribution?',
  },
];
