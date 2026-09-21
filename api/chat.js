import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { createAgentHarness } from '../src/agent-harness.js';

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'ca-central-1' });
const modelId = process.env.BEDROCK_MODEL_ID || 'us.amazon.nova-lite-v1:0';

export async function chat(message, history = [], agentId = 'forge') {
  try {
    const run = createAgentHarness({
      modelId,
      converse: (input) => client.send(new ConverseCommand(input)),
    });
    const result = await run({ agentId, prompt: message, history });
    return { success: true, content: result.answer, agentId: result.agentId, trace: result.trace };
  } catch (error) {
    console.error('Bedrock error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
