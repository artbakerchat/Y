import { Component, ErrorInfo, FormEvent, KeyboardEvent, ReactNode, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Role = 'user' | 'assistant';
type Message = { role: Role; content: string };
type State = { messages?: Message[]; pendingPrompt?: string; agentId?: string; agentMode?: 'auto' | 'manual' };
type AgentRole = { id: string; name: string; focus: string; description: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_ROLES: AgentRole[] = [
  { id: 'forge', name: 'Forge', focus: 'Good Neighbour Coordinator', description: 'Turn community needs and half-formed ideas into clear next steps.' },
  { id: 'food-bank', name: 'Food Bank Coordinator', focus: 'Food access and volunteers', description: 'Organize pantry operations, donations, pickup windows, and volunteer shifts.' },
  { id: 'nonprofit-helpdesk', name: 'Nonprofit Helpdesk', focus: 'Small nonprofit support', description: 'Create practical policies, forms, agendas, grant notes, and operating plans.' },
  { id: 'mutual-aid', name: 'Mutual Aid Hub', focus: 'Neighbour-to-neighbour support', description: 'Coordinate requests, offers, rides, supplies, check-ins, and follow-up safely.' },
  { id: 'civic-knowledge', name: 'Civic Knowledge Assistant', focus: 'Local civic information', description: 'Make public services, community programs, and civic processes easier to understand.' },
  { id: 'bob-dylan', name: 'Bob Dylan', focus: 'Music and songwriting', description: 'Explore folk, blues, songwriting, albums, and lyrical interpretation.' },
  { id: 'santa-claus', name: 'Santa Claus', focus: 'Holiday cheer', description: 'Bring warmth, generosity, apples, presents, and a little ho-ho-ho.' },
  { id: 'orange-doctor-candidatus', name: 'Orange Doctor Candidatus', focus: 'Orange reframing', description: 'You can swipe your situation orange.' },
];
function cleanAssistantResponse(value: unknown) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  const cleaned = text
    .replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking[^>]*>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<analysis[^>]*>[\s\S]*?<\/analysis>/gi, '')
    .trim();
  return cleaned || 'I’m here with you. What would you like to work through?';
}

function isPacificAvailabilityOpen(date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  const currentMinutes = hour * 60 + minute;
  return currentMinutes >= 9 * 60 && currentMinutes < 17 * 60;
}

// ---------------------------------------------------------------------------
// ErrorBoundary
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Top-level error boundary that catches unhandled React render/lifecycle errors
 * and displays a graceful fallback instead of a blank screen.
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // In production this would forward to an error tracking service.
    console.error('[Forge] Uncaught render error:', error, info.componentStack);
  }

  handleReset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="shell" role="alert" aria-live="assertive">
          <main style={{ padding: '56px 0' }}>
            <p className="kicker">Something went wrong</p>
            <h1>Forge ran into a problem.</h1>
            <p className="lead">
              An unexpected error occurred in the interface. Your conversation history is stored
              server-side and will be restored when you reload.
            </p>
            <p style={{ color: '#607386', fontSize: '12px', marginTop: '16px' }}>
              {this.state.error.message}
            </p>
            <button
              onClick={this.handleReset}
              style={{
                marginTop: '24px',
                padding: '10px 20px',
                background: '#7fffe5',
                border: 'none',
                borderRadius: '10px',
                color: '#061522',
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </main>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// ChatPanel
// ---------------------------------------------------------------------------

interface ChatPanelProps {
  messages: Message[];
  agentName: string;
  busy: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}

/**
 * Renders the conversation history and the message composer.
 */
function ChatPanel({ messages, agentName, busy, draft, onDraftChange, onSubmit }: ChatPanelProps) {
  const composerTarget = agentName || 'Larboard';
  const [isAvailable, setIsAvailable] = useState(() => isPacificAvailabilityOpen());

  useEffect(() => {
    const updateAvailability = () => setIsAvailable(isPacificAvailabilityOpen());
    const interval = window.setInterval(updateAvailability, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <article className="card conversation">
      <div className="card-head">
        <h2>Conversation</h2>
        <span className="badge">{agentName}</span>
      </div>

      <div className="availability" role="status" aria-live="polite">
        <span className={`availability-dot${isAvailable ? ' is-open' : ''}`} aria-hidden="true" />
        <span>Available 9:00 AM–5:00 PM Pacific</span>
        <strong className={isAvailable ? 'is-open' : ''}>{isAvailable ? 'OPEN' : 'CLOSED'}</strong>
      </div>

      <div className={`chat${messages.length ? '' : ' is-empty'}`}>
        {messages.map((message, index) => (
            <div className={`message ${message.role}`} key={`${index}-${message.content}`}>
              <div className="avatar role-label" aria-label={message.role === 'user' ? 'You' : agentName} title={message.role === 'user' ? 'You' : agentName}>{message.role === 'user' ? 'You' : agentName}</div>
              <div className="bubble">{message.content}</div>
            </div>
          ))}
      </div>

      <form className="composer" onSubmit={onSubmit}>
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Say hello to ${composerTarget}…`}
          aria-label={`Message ${composerTarget}`}
          rows={1}
        />
        <button disabled={busy} type="submit" aria-label="Send message">
          ↑
        </button>
      </form>
      <p className="hint">Enter to send · Shift + Enter for a new line</p>
    </article>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeAgentId, setActiveAgentId] = useState('forge');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const stateWrite = useRef(Promise.resolve());

  useEffect(() => {
    Promise.all([
      fetch('/api/state').then((r) => r.json() as Promise<State>),
    ])
      .then(([saved]) => {
        setMessages(saved.messages || []);
        const savedAgentId = AGENT_ROLES.some((role) => role.id === saved.agentId) ? saved.agentId! : 'forge';
        setActiveAgentId(savedAgentId);
      })
      .catch(() => undefined);
  }, []);

  function saveState(next: Partial<State>): Promise<State> {
    // Serialize patches so quick conversation changes cannot race.
    const write = stateWrite.current.catch(() => undefined).then(async () => {
      const response = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error('Could not save workspace state.');
      return (await response.json()) as State;
    });
    stateWrite.current = write.then(() => undefined, () => undefined);
    return write;
  }

  async function submitMessage(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy) {
      return;
    }
    if (message.split(/\s+/).length > 52) {
      return;
    }
    if (message.split(/\s+/).some((word) => word.length > 16)) {
      return;
    }

    if (message.toLowerCase() === 'clear') {
      setDraft('');
      setBusy(true);
      setMessages([]);
      try {
        await saveState({ messages: [], pendingPrompt: '' });
      } catch {
        setMessages(messages);
      } finally {
        setBusy(false);
      }
      return;
    }

    setDraft('');
    setBusy(true);
    const nextMessages: Message[] = [
      ...messages,
      { role: 'user', content: message },
      { role: 'assistant', content: 'One moment…' },
    ];
    setMessages(nextMessages);

    try {
      await saveState({ messages: nextMessages.slice(0, -1) });
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = (await response.json()) as { answer?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }
      if (typeof (data as { agentId?: string }).agentId === 'string') {
        setActiveAgentId((data as { agentId: string }).agentId);
      }
      setMessages([
        ...nextMessages.slice(0, -1),
        { role: 'assistant', content: cleanAssistantResponse(data.answer || '') },
      ]);
    } catch (error) {
      setMessages([
        ...nextMessages.slice(0, -1),
        {
          role: 'assistant',
          content: `I'm having trouble connecting right now. ${error instanceof Error ? error.message : 'Please try again.'}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ErrorBoundary>
      <div className="shell">
        <main>
          <section className="workspace">
            <ChatPanel
              messages={messages}
              agentName={AGENT_ROLES.find((role) => role.id === activeAgentId)?.name || 'Forge'}
              busy={busy}
              draft={draft}
              onDraftChange={setDraft}
              onSubmit={submitMessage}
            />
          </section>
        </main>
      </div>
    </ErrorBoundary>
  );
}
