// Only server-configured HTTPS URLs and per-agent secrets are used for routing.
export function peerConfigured(profile, env) {
  try {
    const url = new URL(env[profile.endpointEnv]);
    return url.protocol === 'https:' && !url.username && !url.password &&
      Boolean(env[profile.tokenEnv]?.trim());
  } catch {
    return false;
  }
}

export async function invokePeer(profile, message, sessionId, env) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionId));
  const sessionKey = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const response = await fetch(env[profile.endpointEnv], {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90000),
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env[profile.tokenEnv].trim()}`,
    },
    body: JSON.stringify({ session_id: `${profile.id}-${sessionKey}`, prompt: message }),
  });
  if (!response.ok || response.headers.get('x-agent-id') !== profile.id) {
    await response.body?.cancel();
    throw new Error(`Peer ${profile.id} is unavailable or returned a different identity.`);
  }
  const answer = await response.text();
  if (!answer.trim()) throw new Error(`Peer ${profile.id} returned an empty response.`);
  return { answer, agent: true, agentId: profile.id };
}
