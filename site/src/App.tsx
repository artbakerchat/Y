import { FormEvent, useEffect, useRef, useState } from 'react';

type Message = { role: 'user' | 'assistant'; content: string };
type AgentProfile = { id: string; name: string; description: string };
type SessionState = { agentId?: string; messages?: Message[] };

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [agentId, setAgentId] = useState('forge');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
      })
      .catch(() => {
        if (active) setError('Unable to load the available agents.');
      });
    return () => { active = false; };
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleAgentChange = async (nextAgentId: string) => {
    if (!nextAgentId || nextAgentId === agentId || loading) return;
    setAgentId(nextAgentId);
    setMessages([]);
    setError('');
    try {
      const response = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: nextAgentId }),
      });
      if (!response.ok) throw new Error('Unable to switch agents');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to switch agents');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setLoading(true);
    setError('');

    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

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
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.answer ?? data.content }]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to get response';
      setError(errorMsg);
      setMessages(prev => prev.slice(0, -1)); // Remove the user message we added
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chat-container">
      <header className="chat-header">
        <div className="chat-heading">
          <div>
            <h1>Bee Chat</h1>
            <p>Choose an agent for this conversation</p>
          </div>
          <label className="agent-picker">
            <span>Agent</span>
            <select value={agentId} onChange={(event) => handleAgentChange(event.target.value)} disabled={loading || !agents.length}>
              {agents.length === 0 && <option value="forge">Loading agents…</option>}
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </label>
        </div>
        <p className="agent-description">{agents.find((agent) => agent.id === agentId)?.description}</p>
      </header>

      <main className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <h2>Welcome to Bee Chat</h2>
            <p>Start a conversation with Nova AI</p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={`message message-${msg.role}`}>
            <div className="message-content">{msg.content}</div>
          </div>
        ))}

        {error && (
          <div className="message message-error">
            <div className="message-content">Error: {error}</div>
          </div>
        )}

        {loading && (
          <div className="message message-assistant loading">
            <div className="message-content">
              <span className="typing-indicator">
                <span></span><span></span><span></span>
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      <footer className="chat-footer">
        <form onSubmit={handleSubmit} className="chat-input-form">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            disabled={loading}
            className="chat-input"
            autoFocus
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="chat-send-btn"
            aria-label="Send message"
            title="Send message"
          >
            →
          </button>
        </form>
      </footer>
    </div>
  );
}

export default App;
