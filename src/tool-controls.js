// Deterministic tool-call controls for the Worker agent loop.
// Create one controller per invocation; only successful calls unlock workflows.
export function createToolController({ tools, maxCallsPerTool = 3 }) {
  if (!Number.isInteger(maxCallsPerTool) || maxCallsPerTool < 1) {
    throw new RangeError('maxCallsPerTool must be a positive integer');
  }
  const registry = new Map(tools.map((tool) => [tool.spec.name, tool.fn]));
  const counts = new Map();
  const ledger = [];

  return {
    getCounts: () => Object.fromEntries(counts),
    getLedger: () => ledger.map((entry) => ({ ...entry })),
    async execute({ toolUseId, name, input }) {
      const count = (counts.get(name) || 0) + 1;
      counts.set(name, count);
      let status = 'blocked';
      let result;
      if (count > maxCallsPerTool) {
        result = `'${name}' has already been called ${maxCallsPerTool} time(s) this request. Do not call it again.`;
      } else if (!registry.has(name) || typeof registry.get(name) !== 'function') {
        status = 'error';
        result = `Unknown tool: ${name}`;
      } else if (name === 'suggest_related_words' && !ledger.some(
        (entry) => ['get_palette', 'search_palette'].includes(entry.name) && entry.status === 'success',
      )) {
        result = 'You must call get_palette or search_palette first to understand the existing palette before suggesting new words.';
      } else {
        try {
          const value = await registry.get(name)(input || {});
          result = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
          status = 'success';
        } catch (error) {
          status = 'error';
          result = `Tool error: ${String(error?.message || error).slice(0, 120)}`;
        }
      }
      ledger.push({ name, status });
      return {
        toolResult: {
          toolUseId,
          status: status === 'success' ? 'success' : 'error',
          content: [{ text: result }],
        },
      };
    },
  };
}
