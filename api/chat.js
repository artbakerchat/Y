import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { createAgentHarness } from '../src/agent-harness.js';

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'ca-central-1' });
const modelId = process.env.BEDROCK_MODEL_ID || 'us.amazon.nova-lite-v1:0';

export async function chat(message, history = [], agentId = 'forge', sessionId = 'local-dev-session') {
  try {
    // When credentials live in Cloudflare Worker secrets, use the Worker as
    // the model boundary. It owns Nova, routing, tools, rate limits, and the
    // AgentCore selection; the local Node process should not need AWS keys.
    const workerUrl = process.env.FORGE_WORKER_URL?.trim().replace(/\/$/, '');
    const workerToken = process.env.FORGE_WORKER_TOKEN?.trim();
    if (workerUrl) {
      if (!workerToken) {
        return {
          success: false,
          status: 503,
          error: 'FORGE_WORKER_TOKEN is required when FORGE_WORKER_URL is configured.'
        };
      }
      const response = await fetch(`${workerUrl}/api/agent-gateway`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${workerToken}`,
          'content-type': 'application/json',
          'x-forge-worker-token': workerToken,
        },
        body: JSON.stringify({
          session_id: sessionId,
          agent: agentId,
          prompt: message,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          success: false,
          status: response.status >= 500 ? 502 : response.status,
          error: typeof body.error === 'string' ? body.error : `Worker request failed (${response.status}).`,
        };
      }
      return {
        success: true,
        content: body.answer,
        agentId: body.agentId || agentId,
        trace: body.trace,
      };
    }

    const run = createAgentHarness({
      modelId,
      converse: (input) => client.send(new ConverseCommand(input)),
    });
    const result = await run({ agentId, prompt: message, history });
    return { success: true, content: result.answer, agentId: result.agentId, trace: result.trace };
  } catch (error) {
    console.error('Bedrock error:', error);
    const name = error instanceof Error ? error.name : '';
    const messageText = error instanceof Error ? error.message : 'Unknown error';
    const credentialsError = /credential|access.?denied|security token|not authorized/i.test(`${name} ${messageText}`);
    return {
      success: false,
      status: credentialsError ? 503 : 502,
      error: credentialsError
        ? 'Bedrock is unavailable: check AWS credentials and permissions.'
        : `Bedrock request failed: ${messageText}`
    };
  }
}
