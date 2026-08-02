import { useEffect, useMemo, useRef, useState } from 'react';

interface AgentStatus {
  provider: string;
  model: string | null;
  source: 'settings' | 'env' | 'none';
  hasKey: boolean;
  active: boolean;
}

interface ChatMessage {
  id?: number;
  role: 'user' | 'agent' | 'error';
  text: string;
  streaming?: boolean;
  tool?: string | null;
  createdAt?: string;
  usage?: TokenUsage;
}

interface TokenUsage {
  tokens: number;
  contextWindow: number;
  compactAt: number;
  percent: number;
  model: string | null;
  provider: string;
}

interface HistoryResponse {
  messages: Array<{
    id: number;
    role: 'user' | 'assistant';
    content: string;
    createdAt: string;
  }>;
  conversationId: string;
}

const TOOL_LABELS: Record<string, string> = {
  list_jobs: 'revisando las ofertas',
  list_applications: 'revisando tus postulaciones',
  list_platforms: 'revisando las plataformas',
  get_errors: 'revisando los errores',
  trigger_scan: 'encolando el escaneo',
  set_auto_scan: 'configurando la búsqueda automática',
};

const SUGGESTIONS = [
  {
    title: 'Analiza mi CV',
    body: 'Revisá mi currículum y decime qué mejoro para postular a jefe de mantención.',
    icon: 'doc',
  },
  {
    title: 'Ofertas en refrigeración',
    body: 'Buscá ofertas reales para técnico en refrigeración industrial en la zona sur.',
    icon: 'briefcase',
  },
  {
    title: 'Mejorar resumen profesional',
    body: 'Reescribí mi resumen del CV para que enganche en los primeros tres segundos.',
    icon: 'sparkles',
  },
  {
    title: 'Carta para postular',
    body: 'Ayudame a redactar una carta de presentación para una oferta que vi.',
    icon: 'mail',
  },
];

function formatNumber(n: number): string {
  return n.toLocaleString('es-CL');
}

function colorForPercent(percent: number): string {
  if (percent >= 80) return 'rgb(var(--danger))';
  if (percent >= 50) return 'rgb(var(--warn))';
  return 'rgb(var(--accent))';
}

function Icon({ name, className = 'h-4 w-4' }: { name: string; className?: string }) {
  const common = {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
  };
  switch (name) {
    case 'doc':
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="9" y1="13" x2="15" y2="13" />
          <line x1="9" y1="17" x2="15" y2="17" />
        </svg>
      );
    case 'briefcase':
      return (
        <svg {...common}>
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        </svg>
      );
    case 'sparkles':
      return (
        <svg {...common}>
          <path d="M12 3v3m0 12v3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M3 12h3m12 0h3M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1" />
        </svg>
      );
    case 'mail':
      return (
        <svg {...common}>
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="m22 7-10 5L2 7" />
        </svg>
      );
    case 'send':
      return (
        <svg {...common}>
          <path d="m22 2-7 20-4-9-9-4 20-7Z" />
          <path d="M22 2 11 13" />
        </svg>
      );
    case 'user':
      return (
        <svg {...common}>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      );
    case 'agent':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9 9h.01M15 9h.01M9 15c1 1 2 1.5 3 1.5s2-.5 3-1.5" />
        </svg>
      );
    default:
      return null;
  }
}

function StatusPill({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
      accent ? 'border-accent/30 bg-accent/10 text-accent' : 'border-border bg-elevated/60 text-fg-muted'
    }`}>
      <span className="text-[10px] uppercase tracking-wider opacity-70">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function TokenPill({ usage }: { usage: TokenUsage }) {
  const color = colorForPercent(usage.percent);
  const radius = 7;
  const circ = 2 * Math.PI * radius;
  const offset = circ * (1 - Math.min(100, usage.percent) / 100);
  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-elevated/60 px-3 py-1.5 text-xs">
      <svg width="18" height="18" viewBox="0 0 18 18" className="flex-shrink-0">
        <circle cx="9" cy="9" r={radius} fill="none" stroke="rgb(var(--border-strong))" strokeWidth="2" />
        <circle
          cx="9"
          cy="9"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 9 9)"
          style={{ transition: 'stroke-dashoffset 400ms ease' }}
        />
      </svg>
      <div className="flex flex-col leading-tight">
        <span className="font-medium text-foreground" style={{ color }}>
          {formatNumber(usage.tokens)} <span className="opacity-50">/ {formatNumber(usage.contextWindow)}</span>
        </span>
        <span className="text-[10px] text-fg-muted">{usage.percent}% · compacta a {formatNumber(usage.compactAt)}</span>
      </div>
    </div>
  );
}

function StatusBar({ status, usage }: { status: AgentStatus | null; usage: TokenUsage | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status && (
        <>
          <StatusPill label="Proveedor" value={status.provider} accent={status.active} />
          <StatusPill label="Modelo" value={status.model ?? '—'} />
          <StatusPill label="Credenciales" value={status.hasKey ? 'OK' : 'faltan'} />
          <StatusPill label="Estado" value={status.active ? 'activo' : 'inactivo'} accent={status.active} />
        </>
      )}
      {usage && <TokenPill usage={usage} />}
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-10">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent elev-2 mb-6">
        <Icon name="agent" className="h-7 w-7" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight">Hola, Eric</h2>
      <p className="mt-2 max-w-md text-center text-sm text-fg-muted">
        Soy tu asesor laboral con memoria persistente. Contame en qué te puedo ayudar hoy y armo un plan a tu medida.
      </p>
      <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() => onPick(s.body)}
            className="group flex items-start gap-3 rounded-xl border border-border bg-elevated/40 p-4 text-left transition-all hover:border-accent/40 hover:bg-elevated"
          >
            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <Icon name={s.icon} className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{s.title}</p>
              <p className="mt-0.5 truncate text-xs text-fg-muted">{s.body}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  const isError = msg.role === 'error';
  const isStreaming = msg.streaming;

  if (isError) {
    return (
      <div className="flex justify-center fade-up">
        <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-danger" />
          {msg.text}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex w-full gap-3 fade-up ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full elev-1 ${
        isUser ? 'bg-elevated text-fg-muted' : 'bg-accent/15 text-accent'
      }`}>
        <Icon name={isUser ? 'user' : 'agent'} className="h-4 w-4" />
      </div>
      <div className={`min-w-0 max-w-[75%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'rounded-2xl rounded-tr-md bg-accent/15 text-foreground border border-accent/20'
            : 'rounded-2xl rounded-tl-md bg-elevated text-foreground border border-border'
        }`}>
          {isStreaming && msg.text === '' ? (
            <span className="pulse-ring text-fg-muted">
              {msg.tool ? `${TOOL_LABELS[msg.tool] ?? 'consultando datos'}…` : 'pensando…'}
            </span>
          ) : (
            <div className="whitespace-pre-wrap break-words">{msg.text}</div>
          )}
          {isStreaming && msg.text !== '' && (
            <span className="streaming-caret ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 bg-foreground align-middle" />
          )}
        </div>
        <div className={`mt-1 px-1 text-[10px] uppercase tracking-wider text-fg-muted opacity-0 transition-opacity ${isStreaming ? 'opacity-100' : ''}`}>
          {isUser ? 'Vos' : 'Asesor'}
        </div>
      </div>
    </div>
  );
}

export default function AgentChat() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const latestUsageRef = useRef<TokenUsage | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/agent/status')
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  // Fetch initial usage so the TokenPill is visible right away, not only
  // after the first chat turn.
  useEffect(() => {
    fetch('/api/agent/usage')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.tokens === 'number') latestUsageRef.current = data;
      })
      .catch(() => { /* best-effort */ });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingHistory(true);
    fetch('/api/agent/messages')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no history'))))
      .then((data: HistoryResponse) => {
        if (cancelled) return;
        const restored: ChatMessage[] = data.messages.map((m) => ({
          id: m.id,
          role: m.role === 'user' ? 'user' : 'agent',
          text: m.content,
          createdAt: m.createdAt,
        }));
        setMessages(restored);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-scroll to bottom as messages arrive / stream.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const latestUsage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const usage = messages[i]!.usage;
      if (usage) return usage;
    }
    return latestUsageRef.current;
  }, [messages, latestUsageRef.current]);

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);

    setMessages((prev) => [...prev, { role: 'user', text }]);
    setMessages((prev) => [...prev, { role: 'agent', text: '', streaming: true }]);

    try {
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ message: text, stream: true }),
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        setMessages((prev) => {
          const next = [...prev];
          const idx = next.findIndex((m) => m.streaming);
          if (idx >= 0) next.splice(idx, 1);
          next.push({ role: 'error', text: data.error ?? 'El agente no está disponible.' });
          return next;
        });
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantText = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          let event = 'message';
          let data = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;
          try {
            const parsed = JSON.parse(data);
            if (event === 'message' && typeof parsed.delta === 'string') {
              assistantText += parsed.delta;
              setMessages((prev) => {
                const next = [...prev];
                const idx = next.findIndex((m) => m.streaming);
                if (idx >= 0) next[idx] = { ...next[idx]!, text: assistantText, tool: null };
                return next;
              });
            } else if (event === 'status' && typeof parsed.tool === 'string') {
              setMessages((prev) => {
                const next = [...prev];
                const idx = next.findIndex((m) => m.streaming);
                if (idx >= 0) next[idx] = { ...next[idx]!, tool: parsed.tool };
                return next;
              });
            } else if (event === 'done' && typeof parsed.reply === 'string') {
              if (parsed.usage) latestUsageRef.current = parsed.usage;
              setMessages((prev) => {
                const next = [...prev];
                const idx = next.findIndex((m) => m.streaming);
                if (idx >= 0) next[idx] = { role: 'agent', text: parsed.reply, usage: parsed.usage };
                return next;
              });
            } else if (event === 'error') {
              setMessages((prev) => {
                const next = [...prev];
                const idx = next.findIndex((m) => m.streaming);
                if (idx >= 0) next.splice(idx, 1);
                if (!parsed.cancelled) {
                  next.push({ role: 'error', text: parsed.error ?? 'stream_failed' });
                }
                return next;
              });
            }
          } catch {
            // ignore malformed frame
          }
        }
      }
    } catch {
      setMessages((prev) => {
        const next = [...prev];
        const idx = next.findIndex((m) => m.streaming);
        if (idx >= 0) next.splice(idx, 1);
        next.push({ role: 'error', text: 'No se pudo contactar al servidor.' });
        return next;
      });
    } finally {
      setSending(false);
    }
  }

  function clearChat() {
    if (!confirm('¿Borrar el historial visible? La conversación guardada seguirá en la base de datos.')) return;
    setMessages([]);
  }

  const showEmpty = !loadingHistory && messages.length === 0;

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-6 py-4">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Asesor laboral</h1>
          <p className="mt-0.5 text-xs text-fg-muted">
            {loadingHistory ? 'Cargando historial…' : showEmpty ? 'Listo para arrancar' : `${messages.filter((m) => m.role !== 'error').length} turnos en conversación`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {messages.length > 0 && !loadingHistory && (
            <button
              type="button"
              onClick={clearChat}
              className="rounded-lg border border-border bg-elevated/40 px-3 py-1.5 text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-foreground"
            >
              Limpiar vista
            </button>
          )}
        </div>
      </header>

      {/* Status row */}
      <div className="flex-shrink-0 border-b border-border bg-background px-6 py-3">
        <StatusBar status={status} usage={latestUsage} />
      </div>

      {/* Conversation / empty state */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {showEmpty ? (
          <EmptyState onPick={(t) => send(t)} />
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-6">
            {messages.map((msg, i) => (
              <MessageBubble key={msg.id ?? (msg.streaming ? 'streaming' : i)} msg={msg} />
            ))}
            {sending && !messages.some((m) => m.streaming) && (
              <div className="flex items-center gap-3 fade-up">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 text-accent elev-1">
                  <Icon name="agent" className="h-4 w-4" />
                </div>
                <div className="rounded-2xl rounded-tl-md border border-border bg-elevated px-4 py-3 text-sm text-fg-muted">
                  <span className="pulse-ring">pensando…</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Composer (sticky bottom) */}
      <div className="flex-shrink-0 border-t border-border bg-background px-6 py-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="mx-auto flex w-full max-w-3xl items-end gap-3"
        >
          <div className="flex-1 rounded-2xl border border-border bg-elevated transition-colors focus-within:border-accent/50 focus-within:bg-elevated/80 elev-1">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Preguntale al asesor sobre tu CV, ofertas, postulaciones…"
              rows={1}
              className="w-full resize-none bg-transparent px-4 py-3 text-sm leading-relaxed text-foreground placeholder:text-fg-muted focus:outline-none"
              style={{ minHeight: '44px', maxHeight: '160px' }}
            />
          </div>
          <button
            type="submit"
            disabled={sending || input.trim() === ''}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-accent text-background transition-all hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40 elev-1"
            aria-label="Enviar"
          >
            <Icon name="send" className="h-4 w-4" />
          </button>
        </form>
        <p className="mx-auto mt-2 max-w-3xl text-center text-[10px] text-fg-muted opacity-70">
          Enter envía · Shift+Enter hace salto de línea · El agente recuerda toda tu conversación
        </p>
      </div>
    </div>
  );
}
