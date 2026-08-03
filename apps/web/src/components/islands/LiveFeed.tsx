import { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { recentEvents } from '../../stores/activity.js';
import { connectToEventStream } from '../../lib/sse-client.js';

export default function LiveFeed() {
  const events = useStore(recentEvents);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const disconnect = connectToEventStream(setConnected);
    return () => {
      disconnect();
    };
  }, []);

  return (
    <div className="rounded border border-border">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-medium">Eventos en vivo</span>
        <span
          className={`rounded px-2 py-0.5 text-xs ${
            connected ? 'bg-green-500/20 text-green-400' : 'bg-slate-500/20 text-slate-400'
          }`}
        >
          {connected ? 'Conectado' : 'Desconectado'}
        </span>
      </div>
      <div className="max-h-[60vh] overflow-auto">
        {events.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted">
            Sin eventos todavía. Iniciá el worker para ver actividad.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((event) => (
              <li key={event.id} className="px-4 py-3 text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="rounded bg-accent/20 text-accent px-2 py-0.5 text-xs font-mono">
                    {event.kind}
                  </span>
                  <span className="text-xs text-muted">{event.occurredAt}</span>
                </div>
                <div className="text-foreground">{event.message}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
