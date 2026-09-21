export interface Session {
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  expiresAt: number;
  createdAt?: number;
}

export function createSession() {
  return {
    messages: [],
    expiresAt: Date.now() + (48 * 60 * 60 * 1000),
    createdAt: Date.now(),
  };
}

export function isSessionExpired(session) {
  return session.expiresAt && session.expiresAt <= Date.now();
}
