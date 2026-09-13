// Read the runtime ARN from ignored deployment state and send it via stdin.
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

const deployment = JSON.parse(await readFile('.data/agentcore-deployment.json', 'utf8'));
if (!deployment.agentRuntimeArn?.includes(':runtime/larboard_forge_agents-')) {
  throw new Error('Missing or unexpected Larboard runtime ARN');
}
let input = deployment.agentRuntimeArn;
let command = ['wrangler', 'secret', 'put', 'AGENTCORE_RUNTIME_ARN'];
if (process.argv.includes('--sync-aws')) {
  const credentials = await new BedrockRuntimeClient({ region: deployment.region }).config.credentials();
  input = JSON.stringify({
    AGENTCORE_RUNTIME_ARN: deployment.agentRuntimeArn,
    AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    // The Worker trims this value; clear any old session token when using
    // credentials that do not require one. Never mix credential sets.
    AWS_SESSION_TOKEN: credentials.sessionToken || ' ',
  });
  command = ['wrangler', 'secret', 'bulk'];
}
const result = spawnSync('npx', command, {
  input,
  stdio: ['pipe', 'inherit', 'inherit'],
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
