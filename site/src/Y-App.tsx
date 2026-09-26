import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';

type Message = { role: 'user' | 'assistant'; content: string };
type AgentProfile = { id: string; name: string; description: string };
type SessionState = { agentId?: string; messages?: Message[] };

function suggestionsFor(agent?: AgentProfile) {
  const name = agent?.name || 'this agent';
  return [
    `What can ${name} help me with?`,
    'Give me a short example of your best work.',
    'Ask me a clarifying question, then get started.',
  ];
}

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [agentId, setAgentId] = useState('forge');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Loading agents.');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  const currentAgent = agents.find((agent) => agent.id === agentId);
  const suggestions = useMemo(() => suggestionsFor(currentAgent), [currentAgent]);

  useEffect(() => {
    let active = true;
    Promise.all([fetch('/api/agents'), fetch('/api/state')])
      .then(async ([agentsResponse, stateResponse]) => {
        if (!agentsResponse.ok || !stateResponse.ok) throw new Error('Unable to load agents');
        const availableAgents: AgentProfile[] = await agentsResponse.json();
        const state: SessionState = await stateResponse.json();
        if (!active) return;
        setAgents(availableAgents);
        if (state.agentId) setAgentId(state.agentId);
        if (Array.isArray(state.messages)) setMessages(state.messages);
        setStatus('Agents ready.');
      })
      .catch(() => {
        if (active) {
          setError('Unable to load the available agents.');
          setStatus('Could not load agents.');
        }
      })
      .finally(() => {
        if (active) setBootstrapping(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, error]);

  const handleAgentChange = async (nextAgentId: string) => {
    if (!nextAgentId || nextAgentId === agentId || loading) return;
    if (messages.length > 0) {
      const nextName = agents.find((agent) => agent.id === nextAgentId)?.name || 'this agent';
      const confirmed = window.confirm(`Switch to ${nextName}? This starts a new conversation.`);
      if (!confirmed) return;
    }
    const previousAgentId = agentId;
    const previousMessages = messages;
    setAgentId(nextAgentId);
    setMessages([]);
    setError('');
    setStatus('Switching agents.');
    try {
      const response = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: nextAgentId }),
      });
      if (!response.ok) throw new Error('Unable to switch agents');
      const nextName = agents.find((agent) => agent.id === nextAgentId)?.name || 'the selected agent';
      setStatus(`Now talking with ${nextName}.`);
      inputRef.current?.focus();
    } catch (err) {
      setAgentId(previousAgentId);
      setMessages(previousMessages);
      setError(err instanceof Error ? err.message : 'Unable to switch agents');
      setStatus('Agent switch failed.');
    }
  };

  const sendPrompt = async (prompt: string) => {
    const userMessage = prompt.trim();
    if (!userMessage || loading || bootstrapping) return;

    setInput('');
    setLoading(true);
    setError('');
    setStatus('Sending message.');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: userMessage,
          agent: agentId,
          history: messages,
        }),
      });

      if (!response.ok) {
        let detail = '';
        try {
          const failure = await response.json();
          detail = typeof failure.error === 'string' ? failure.error : '';
        } catch {
          // Keep the status-only fallback for non-JSON server responses.
        }
        throw new Error(detail || `API error: ${response.status}`);
      }

      const data = await response.json();
      if (data.agentId && data.agentId !== agentId) setAgentId(data.agentId);
      setMessages((prev) => [...prev, { role: 'assistant', content: data.answer ?? data.content }]);
      setStatus('Response received.');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to get response';
      setError(errorMsg);
      setMessages((prev) => prev.slice(0, -1));
      setInput(userMessage);
      setStatus('Message failed.');
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void sendPrompt(input);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendPrompt(input);
    }
  };

  const composerDisabled = loading || bootstrapping || Boolean(error && agents.length === 0);

  return (
    <div className="chat-container">
      <a className="skip-link" href="#conversation" onClick={(event) => {
        event.preventDefault();
        mainRef.current?.focus();
      }}>
        Skip to conversation
      </a>

      <header className="chat-header">
        <div className="chat-heading">
          <div>
            <p className="product-kicker">Bee Chat</p>
            <h1>Conversation</h1>
            <p>Choose an agent, then ask a question</p>
          </div>
          <label className="agent-picker">
            <span>Agent</span>
            <select
              value={agentId}
              onChange={(event) => void handleAgentChange(event.target.value)}
              disabled={loading || bootstrapping || !agents.length}
              aria-describedby="agent-description"
            >
              {agents.length === 0 && <option value="forge">{bootstrapping ? 'Loading agents…' : 'No agents available'}</option>}
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </label>
        </div>
        <p id="agent-description" className="agent-description">
          {bootstrapping
            ? 'Loading the agents you can talk with.'
            : currentAgent?.description || 'Select an agent to see what they can help with.'}
        </p>
      </header>

      <div className="sr-only" role="status" aria-live="polite">{status}</div>

      <main
        id="conversation"
        className="chat-messages"
        ref={mainRef}
        tabIndex={-1}
        aria-label="Conversation"
      >
        {messages.length === 0 && !loading && (
          <div className="chat-welcome">
            <p className="welcome-eyebrow">{bootstrapping ? 'Getting ready' : currentAgent?.name || 'Bee Chat'}</p>
            <h2>{bootstrapping ? 'Loading Bee Chat' : `Talk with ${currentAgent?.name || 'an agent'}`}</h2>
            <p>
              {bootstrapping
                ? 'Fetching available agents and any saved conversation.'
                : currentAgent?.description || 'Start a conversation when an agent is ready.'}
            </p>
            {!bootstrapping && agents.length > 0 && (
              <div className="suggestion-row" aria-label="Suggested prompts">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="suggestion-chip"
                    onClick={() => void sendPrompt(suggestion)}
                    disabled={composerDisabled}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {(messages.length > 0 || error || loading) && (
          <div className="thread">
            {messages.length > 0 && (
              <ol className="message-log" aria-live="polite" aria-relevant="additions">
                {messages.map((msg, idx) => (
                  <li key={`${msg.role}-${idx}`} className={`message message-${msg.role}`}>
                    <span className="message-role">{msg.role === 'user' ? 'You' : currentAgent?.name || 'Assistant'}</span>
                    <div className="message-content">{msg.content}</div>
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
                <span className="message-role">{currentAgent?.name || 'Assistant'}</span>
                <div className="message-content">
                  <span className="typing-indicator">
                    <span></span><span></span><span></span>
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      <footer className="chat-footer">
        <form onSubmit={handleSubmit} className="chat-input-form">
          <label className="sr-only" htmlFor="chat-input">Message</label>
          <textarea
            id="chat-input"
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={currentAgent ? `Message ${currentAgent.name}` : 'Type a message'}
            disabled={composerDisabled}
            className="chat-input"
            rows={1}
            autoFocus
            aria-busy={loading}
          />
          <button
            type="submit"
            disabled={composerDisabled || !input.trim()}
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
    </div>
  );
}

export default App;
