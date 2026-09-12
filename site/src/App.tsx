import { Component, ErrorInfo, FormEvent, KeyboardEvent, ReactNode, useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Role = 'user' | 'assistant';
type Message = { role: Role; content: string };
type State = { palette?: string[]; messages?: Message[]; pendingPrompt?: string };
type AgentRole = { id: string; name: string; focus: string; description: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STARTER_WORDS = ['anchor', 'pinnacle', 'summit', 'twilight', 'static', 'ocean'];
const AGENT_ROLES: AgentRole[] = [
  { id: 'neighbour', name: 'Good Neighbour', focus: 'Community support', description: 'Turn local needs into clear, practical next steps.' },
  { id: 'food-bank', name: 'Food Bank', focus: 'Volunteer coordination', description: 'Organize shifts, donations, and welcoming pantry operations.' },
  { id: 'nonprofit', name: 'Nonprofit Helpdesk', focus: 'Small-organization operations', description: 'Shape lightweight policies, templates, and plans.' },
  { id: 'mutual-aid', name: 'Mutual Aid Hub', focus: 'Neighbour-to-neighbour care', description: 'Structure requests and offers with dignity and consent.' },
  { id: 'civic', name: 'Civic Knowledge', focus: 'Local information', description: 'Make public processes easier to understand and act on.' },
];
const STOP_WORDS = new Set(
  'a an and are as at be by for from how i in is it me of on or that the this to was we what when where with you your can could do does help into our should today will would'.split(
    ' ',
  ),
);

function cleanAssistantResponse(value: unknown) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  const cleaned = text
    .replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking[^>]*>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<analysis[^>]*>[\s\S]*?<\/analysis>/gi, '')
    .trim();
  return cleaned || 'I’m here with you. What would you like to work through?';
}

function extractWords(text: string): string[] {
  return [
    ...new Set(
      (text.toLowerCase().match(/[a-z][a-z'-]{2,15}/g) || []).filter(
        (word) => !STOP_WORDS.has(word),
      ),
    ),
  ].slice(0, 52);
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
          <header>
            <a className="brand" href="/">
              <span className="mark">✦</span>
              <span>
                Larboard<small>agent workspace</small>
              </span>
            </a>
          </header>
          <main style={{ padding: '56px 0' }}>
            <p className="kicker">Something went wrong</p>
            <h1>Forge ran into a problem.</h1>
            <p className="lead">
              An unexpected error occurred in the interface. Your palette and conversation history
              are stored server-side and will be restored when you reload.
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
  busy: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}

/**
 * Renders the conversation history and the message composer.
 */
function ChatPanel({ messages, busy, draft, onDraftChange, onSubmit }: ChatPanelProps) {
  const [openingNote, setOpeningNote] = useState('');

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
        <span className="badge">Forge</span>
      </div>

      {!messages.length && (
        <form className="pre-conversation" onSubmit={(event) => {
          event.preventDefault();
          if (openingNote.trim()) {
            onDraftChange(openingNote.trim());
            setOpeningNote('');
          }
        }}>
          <div>
            <p className="eyebrow">BEFORE WE BEGIN</p>
            <h3>Leave your comments</h3>
            <p className="pre-conversation__copy">Share a little context, a question, or the outcome you’re hoping for.</p>
          </div>
          <textarea value={openingNote} onChange={(event) => setOpeningNote(event.target.value)} placeholder="What’s on your mind?" aria-label="Leave your comments" rows={3} />
          <button type="submit" disabled={!openingNote.trim()}>Use as opening note</button>
        </form>
      )}

      <div className="chat">
        {messages.length ? (
          messages.map((message, index) => (
            <div className={`message ${message.role}`} key={`${index}-${message.content}`}>
              <div className="avatar role-label" aria-label={message.role === 'user' ? 'You' : 'Larboard assistant'} title={message.role === 'user' ? 'You' : 'Larboard assistant'}>{message.role === 'user' ? 'You' : 'Forge'}</div>
              <div className="bubble">{message.content}</div>
            </div>
          ))
        ) : (
          <>
            <div className="message assistant">
              <div className="avatar role-label" aria-label="Larboard assistant" title="Larboard assistant">Forge</div>
              <div className="bubble">Hey — glad you're here. What are you working on?</div>
            </div>
            <div className="message assistant">
              <div className="avatar role-label" aria-label="Larboard assistant" title="Larboard assistant">Forge</div>
              <div className="bubble">
                Try a community request, such as “Help organize volunteers for a food-bank shift.” You can also ask for nonprofit help, mutual-aid coordination, or civic information. If Python is enabled, the response will identify the AgentCore runtime.
              </div>
            </div>
            <div className="message user">
              <div className="avatar role-label" aria-label="You" title="You">You</div>
              <div className="bubble">How many apples can I get from the food bank</div>
            </div>
            <div className="message assistant">
              <div className="avatar role-label" aria-label="Larboard assistant" title="Larboard assistant">Forge</div>
              <div className="bubble">
                Would you like to confirm the default serving plan of one apple per person, or do you have any specific needs or preferences for the food bank distribution?
              </div>
            </div>
            <div className="message user">
              <div className="avatar role-label" aria-label="You" title="You">You</div>
              <div className="bubble">3 people</div>
            </div>
            <div className="message assistant">
              <div className="avatar role-label" aria-label="Larboard assistant" title="Larboard assistant">Forge</div>
              <div className="bubble">
                You can get three apples from the food bank, with one apple per person. Is there anything else you would like to know or plan regarding the food bank distribution?
              </div>
            </div>
          </>
        )}
      </div>

      <form className="composer" onSubmit={onSubmit}>
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Say hello to Forge…"
          aria-label="Message Forge"
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

function AgentRoles() {
  return (
    <section className="roles" aria-labelledby="roles-title">
      <div className="roles-heading">
        <div>
          <p className="kicker">Choose your starting point</p>
          <h2 id="roles-title">A role for the work ahead</h2>
        </div>
        <p>Forge can help you find the right shape for an idea before you take the next step.</p>
      </div>
      <div className="role-grid">
        {AGENT_ROLES.map((role, index) => (
          <article className={`role-card role-card-${index + 1}`} key={role.id}>
            <span className="role-index">0{index + 1}</span>
            <h3>{role.name}</h3>
            <p className="role-focus">{role.focus}</p>
            <p>{role.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// PalettePanel
// ---------------------------------------------------------------------------

interface PalettePanelProps {
  palette: string[];
  region: string;
  wordDraft: string;
  onWordDraftChange: (value: string) => void;
  onAddWords: (event: FormEvent) => void;
  onRemoveWord: (word: string) => void;
}

/**
 * Renders the word palette sidebar: the add-words form, chips, and metrics.
 */
function PalettePanel({
  palette,
  region,
  wordDraft,
  onWordDraftChange,
  onAddWords,
  onRemoveWord,
}: PalettePanelProps) {
  return (
    <aside className="card side">
      <p className="eyebrow">WORD PALETTE</p>
      <h2>Your word garden</h2>

      <form className="palette-form" onSubmit={onAddWords}>
        <input
          value={wordDraft}
          onChange={(event) => onWordDraftChange(event.target.value)}
          placeholder="Type words separated by |"
          aria-label="Add palette words"
        />
        <button type="submit">↵</button>
      </form>

      <div className="chips">
        {palette.map((word) => (
          <button type="button" key={word} onClick={() => onRemoveWord(word)}>
            {word} ×
          </button>
        ))}
      </div>

      <div className="metric">
        <span>Region</span>
        <b>{region}</b>
      </div>
      <div className="metric">
        <span>Palette words</span>
        <b>{palette.length} / 52</b>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [palette, setPalette] = useState(STARTER_WORDS);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [wordDraft, setWordDraft] = useState('');
  const [region, setRegion] = useState('checking…');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/state').then((r) => r.json() as Promise<State>),
      fetch('/api/health').then((r) => r.json() as Promise<{ region?: string }>),
    ])
      .then(([saved, health]) => {
        setPalette(saved.palette?.length ? saved.palette : STARTER_WORDS);
        setMessages(saved.messages || []);
        setRegion(health.region || 'env default');
      })
      .catch(() => setRegion('local preview'));
  }, []);

  async function saveState(next: Partial<State>) {
    const response = await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!response.ok) {
      throw new Error('Could not save workspace state.');
    }
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
    const extractedWords = extractWords(message);
    const nextPalette = [...new Set([...extractedWords, ...palette])].slice(0, 52);
    const nextMessages: Message[] = [
      ...messages,
      { role: 'user', content: message },
      { role: 'assistant', content: 'One moment…' },
    ];
    setMessages(nextMessages);
    setPalette(nextPalette);

    try {
      await saveState({ messages: nextMessages.slice(0, -1), palette: nextPalette });
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = (await response.json()) as { answer?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
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

  function addWords(event: FormEvent) {
    event.preventDefault();
    const additions = wordDraft
      .split('|')
      .map((word) => word.trim())
      .filter((word) => word && word.length <= 16);
    const next = [...new Set([...additions, ...palette])].slice(0, 52);
    setPalette(next);
    setWordDraft('');
    void saveState({ palette: next });
  }

  function removeWord(word: string) {
    const next = palette.filter((item) => item !== word);
    setPalette(next);
    void saveState({ palette: next });
  }

  return (
    <ErrorBoundary>
      <div className="shell">
        <header>
          <a className="brand" href="/">
            <span className="mark">✦</span>
            <span>
              Larboard<small>agent workspace</small>
            </span>
          </a>
          <nav>
            <a href="/">Workspace</a>
            <a href="/prompt">Prompt lab</a>
            <a href="/pinball">Pinball</a>
            <a href="/pricing">Pricing</a>
            <span className="status">
              <i /> ready to chat
            </span>
          </nav>
        </header>

        <main>
          <section className="hero">
            <div>
              <p className="kicker">A thoughtful AI companion</p>
              <h1>
                Build with <em>intent.</em>
                <br />
                Ship with clarity.
              </h1>
              <p className="lead">
                Bring a half-formed idea, a question, or a next step. Forge will talk it through
                with you in plain language.
              </p>
            </div>
          </section>

          <AgentRoles />

          <section className="workspace">
            <ChatPanel
              messages={messages}
              busy={busy}
              draft={draft}
              onDraftChange={setDraft}
              onSubmit={submitMessage}
            />
            <PalettePanel
              palette={palette}
              region={region}
              wordDraft={wordDraft}
              onWordDraftChange={setWordDraft}
              onAddWords={addWords}
              onRemoveWord={removeWord}
            />
          </section>
        </main>

        <footer>Larboard / a quiet place for useful work</footer>
      </div>
    </ErrorBoundary>
  );
}
