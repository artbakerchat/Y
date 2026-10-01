import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';

type Phase = 'checking' | 'idle' | 'pairing' | 'connected' | 'expired' | 'banned' | 'error';
type BeeFile = { name: string; mime: string; base64: string };
type Message = { role: 'user' | 'assistant'; content: string; files?: BeeFile[] };

const POLL_MS = 3000;

function downloadHref(file: BeeFile): string {
  return `data:${file.mime || 'application/octet-stream'};base64,${file.base64}`;
}

export function BeeApp() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [pairingUrl, setPairingUrl] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pollRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Expiry countdown while pairing.
  useEffect(() => {
    if (phase !== 'pairing' || !expiresAt) return;
    const tick = () => {
      const left = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) {
        stopPolling();
        setPhase('expired');
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [phase, expiresAt]);

  const checkStatusOnce = async (): Promise<string> => {
    const response = await fetch('/api/bee/status');
    if (response.status === 404) return 'unknown';
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Status ${response.status}`);
    return data.status as string;
  };

  // Resume an existing session (cookie survives refresh for 24h).
  useEffect(() => {
    let active = true;
    checkStatusOnce()
      .then((status) => {
        if (!active) return;
        if (status === 'approved') setPhase('connected');
        else if (status === 'banned') setPhase('banned');
        else setPhase('idle');
      })
      .catch(() => {
        if (active) setPhase('idle');
      });
    return () => { active = false; };
  }, []);

  const startPairing = async () => {
    setError('');
    setPhase('pairing');
    setPairingUrl('');
    setExpiresAt('');
    setSecondsLeft(0);
    try {
      const response = await fetch('/api/bee/connect', { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Connect failed (${response.status})`);
      setPairingUrl(data.pairing_url);
      setExpiresAt(data.expires_at || '');
      stopPolling();
      pollRef.current = window.setInterval(async () => {
        try {
          const status = await checkStatusOnce();
          if (status === 'approved') {
            stopPolling();
            setPhase('connected');
          } else if (status === 'expired') {
            stopPolling();
            setPhase('expired');
          } else if (status === 'banned') {
            stopPolling();
            setPhase('banned');
          }
        } catch {
          // Keep polling through transient failures.
        }
      }, POLL_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start pairing');
      setPhase('error');
    }
  };

  const sendMessage = async (text: string) => {
    const content = text.trim();
    if (!content || loading) return;
    setInput('');
    setLoading(true);
    setError('');
    const history = messages.slice(-12).map(({ role, content: c }) => ({ role, content: c }));
    setMessages((prev) => [...prev, { role: 'user', content }]);
    try {
      const response = await fetch('/api/bee/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content, history }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) {
          setPhase('idle');
          setMessages([]);
          throw new Error('Session ended. Connect again to continue.');
        }
        throw new Error(typeof data.error === 'string' ? data.error : `Chat failed (${response.status})`);
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: data.answer ?? '', files: data.files }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get a response');
      setMessages((prev) => prev.slice(0, -1));
      setInput(content);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void sendMessage(input);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect your Bee? This ends the session and deletes the stored connection.')) return;
    try {
      await fetch('/api/bee/disconnect', { method: 'POST' });
    } catch {
      // Best effort; the UI resets regardless.
    }
    stopPolling();
    setMessages([]);
    setPairingUrl('');
    setPhase('idle');
  };

  return (
    <div className="chat-container">
      <header className="chat-header">
        <div className="chat-heading">
          <div>
            <p className="product-kicker">Bee Chat</p>
            <h1>Your Bee, anywhere</h1>
            <p>Connect your Bee device — no account, no login</p>
          </div>
          {phase === 'connected' && (
            <button type="button" className="suggestion-chip" onClick={() => void disconnect()}>
              Disconnect
            </button>
          )}
        </div>
      </header>

      <main id="conversation" className="chat-messages" aria-label="Bee conversation">
        {phase === 'checking' && <p>Checking connection…</p>}

        {phase === 'idle' && (
          <div className="chat-welcome">
            <p className="welcome-eyebrow">Get started</p>
            <h2>Connect your Bee</h2>
            <p>
              Scan the code with your phone or open the link, then approve the
              connection in your Bee app. Your conversations stay between you
              and your Bee — nothing is logged or used to train models.
            </p>
            <div className="suggestion-row">
              <button type="button" className="suggestion-chip" onClick={() => void startPairing()}>
                Connect Bee
              </button>
            </div>
          </div>
        )}

        {phase === 'pairing' && (
          <div className="chat-welcome">
            <p className="welcome-eyebrow">Waiting for approval</p>
            <h2>Approve in your Bee app</h2>
            {pairingUrl ? (
              <>
                <div style={{ background: '#fff', padding: 16, borderRadius: 12, display: 'inline-block' }}>
                  <QRCode value={pairingUrl} size={220} />
                </div>
                <p>
                  <a href={pairingUrl} target="_blank" rel="noreferrer">Open the pairing link</a>
                  {' '}on your phone, or scan the code.
                </p>
                {secondsLeft > 0 && <p>Code expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</p>}
                <div className="suggestion-row">
                  <button type="button" className="suggestion-chip" onClick={() => { stopPolling(); setPhase('idle'); }}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <p>Preparing your pairing code…</p>
            )}
          </div>
        )}

        {phase === 'expired' && (
          <div className="chat-welcome">
            <p className="welcome-eyebrow">Code expired</p>
            <h2>That code timed out</h2>
            <p>Pairing codes last a few minutes. Generate a fresh one to try again.</p>
            <div className="suggestion-row">
              <button type="button" className="suggestion-chip" onClick={() => void startPairing()}>
                Get a new code
              </button>
            </div>
          </div>
        )}

        {phase === 'banned' && (
          <div className="chat-welcome">
            <p className="welcome-eyebrow">Unavailable</p>
            <h2>This Bee account is blocked</h2>
            <p>Contact the site owner if you think this is a mistake.</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="chat-welcome">
            <p className="welcome-eyebrow">Something went wrong</p>
            <h2>Couldn’t reach the Bee service</h2>
            <p>{error || 'Try again in a moment.'}</p>
            <div className="suggestion-row">
              <button type="button" className="suggestion-chip" onClick={() => setPhase('idle')}>
                Back
              </button>
            </div>
          </div>
        )}

        {phase === 'connected' && (
          <>
            {messages.length === 0 && !loading && (
              <div className="chat-welcome">
                <p className="welcome-eyebrow">Connected</p>
                <h2>Your Bee is listening</h2>
                <p>Ask about your conversations, get a summary, or have a report made for you.</p>
              </div>
            )}
            {messages.length > 0 && (
              <ol className="message-log" aria-live="polite" aria-relevant="additions">
                {messages.map((msg, idx) => (
                  <li key={`${msg.role}-${idx}`} className={`message message-${msg.role}`}>
                    <span className="message-role">{msg.role === 'user' ? 'You' : 'Bee'}</span>
                    <div className="message-content">{msg.content}</div>
                    {msg.files && msg.files.length > 0 && (
                      <div className="suggestion-row" style={{ marginTop: 8 }}>
                        {msg.files.map((file) => (
                          <a
                            key={file.name}
                            className="suggestion-chip"
                            href={downloadHref(file)}
                            download={file.name}
                            style={{ textDecoration: 'none' }}
                          >
                            Download {file.name}
                          </a>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {error && (
              <div className="error-banner" role="alert">
                <div>
                  <strong>Couldn’t complete that.</strong>
                  <p>{error}</p>
                </div>
                <button type="button" className="error-dismiss" onClick={() => setError('')}>
                  Dismiss
                </button>
              </div>
            )}
            {loading && (
              <div className="message message-assistant loading" aria-hidden="true">
                <span className="message-role">Bee</span>
                <div className="message-content">
                  <span className="typing-indicator">
                    <span></span><span></span><span></span>
                  </span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </main>

      {phase === 'connected' && (
        <footer className="chat-footer">
          <form onSubmit={handleSubmit} className="chat-input-form">
            <label className="sr-only" htmlFor="bee-chat-input">Message</label>
            <textarea
              id="bee-chat-input"
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message your Bee"
              disabled={loading}
              className="chat-input"
              rows={1}
              autoFocus
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="chat-send-btn"
              aria-label="Send message"
              title="Send message"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M3.4 20.6 21 12 3.4 3.4 3.3 10l11.2 2-11.2 2z" />
              </svg>
            </button>
          </form>
          <p className="composer-hint">Enter to send · Shift+Enter for a new line</p>
        </footer>
      )}
    </div>
  );
}

export default BeeApp;
