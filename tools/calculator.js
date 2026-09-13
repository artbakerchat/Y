export function calculate({ operation, left, right }) {
  if (![left, right].every(value => typeof value === 'number' && Number.isFinite(value))) throw new Error('Two finite numbers are required');
  if (!['add', 'subtract', 'multiply', 'divide'].includes(operation)) throw new Error('Unknown operation');
  if (operation === 'divide' && right === 0) throw new Error('Cannot divide by zero');
  const result = { add: () => left + right, subtract: () => left - right, multiply: () => left * right, divide: () => left / right }[operation]();
  if (!Number.isFinite(result)) throw new Error('Result is not finite');
  return { operation, left, right, result };
}

export const calculatorTool = {
  spec: {
    name: 'calculate',
    description: 'Calculate a numeric step exactly. For shares, subtract reserved items first, then divide the remaining amount. Never invent the supplied quantities.',
    inputSchema: { json: { type: 'object', properties: {
      operation: { type: 'string', enum: ['add', 'subtract', 'multiply', 'divide'] },
      left: { type: 'number' }, right: { type: 'number' },
    }, required: ['operation', 'left', 'right'], additionalProperties: false } },
  },
  fn: async input => calculate(input),
};
