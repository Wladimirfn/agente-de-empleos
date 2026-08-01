import { useEffect, useState } from 'react';

interface Application {
  id: number;
  jobId: number;
  status: 'draft' | 'ready' | 'submitted' | 'failed' | 'rejected';
  preparedAt: string | null;
  submittedAt: string | null;
  createdAt: string;
  job: {
    id: number;
    externalId: string;
    title: string;
    company: string | null;
    location: string | null;
    url: string | null;
    platformSlug: string;
  };
  events: Array<{
    id: number;
    kind: string;
    message: string;
    occurredAt: string;
  }>;
}

const STATUS_LABELS: Record<Application['status'], { label: string; tone: 'muted' | 'accent' | 'warn' | 'danger' | 'ok' }> = {
  draft: { label: 'Borrador', tone: 'muted' },
  ready: { label: 'Lista', tone: 'accent' },
  submitted: { label: 'Enviada', tone: 'ok' },
  failed: { label: 'Fallida', tone: 'danger' },
  rejected: { label: 'Rechazada', tone: 'warn' },
};

const NEXT_STATUSES: Record<Application['status'], Application['status'][]> = {
  draft: ['ready', 'submitted', 'rejected'],
  ready: ['submitted', 'rejected'],
  submitted: ['rejected'],
  failed: ['draft'],
  rejected: [],
};

function toneClasses(tone: string): string {
  switch (tone) {
    case 'accent':
      return 'bg-accent/15 text-accent border-accent/30';
    case 'warn':
      return 'bg-warn/15 text-warn border-warn/30';
    case 'danger':
      return 'bg-danger/15 text-danger border-danger/30';
    case 'ok':
      return 'bg-accent/15 text-accent border-accent/30';
    default:
      return 'bg-muted/15 text-fg-muted border-border';
  }
}

export default function ApplicationsList() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/applications')
      .then((r) => (r.ok ? r.json() : { applications: [] }))
      .then((data) => {
        setApps(data.applications ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function changeStatus(appId: number, status: Application['status']) {
    if (updatingId !== null) return;
    setUpdatingId(appId);
    try {
      const response = await fetch('/api/applications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId: appId, status }),
      });
      const data = await response.json();
      if (response.ok && data.application) {
        setApps((prev) => prev.map((a) => (a.id === appId ? data.application : a)));
      } else {
        alert(data.error ?? 'No se pudo actualizar.');
      }
    } catch {
      alert('No se pudo contactar al servidor.');
    } finally {
      setUpdatingId(null);
    }
  }

  function formatDate(iso: string | null): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return iso;
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border bg-background px-6 py-4">
        <h1 className="text-base font-semibold tracking-tight">Postulaciones</h1>
        <p className="mt-0.5 text-xs text-fg-muted">
          Seguimiento de todas tus aplicaciones a ofertas.
        </p>
      </div>

      {/* Stats */}
      <div className="flex-shrink-0 border-b border-border bg-background px-6 py-3">
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="text-fg-muted">Total: <strong className="text-foreground">{apps.length}</strong></span>
          <span className="text-fg-muted">Enviadas: <strong className="text-foreground">{apps.filter((a) => a.status === 'submitted').length}</strong></span>
          <span className="text-fg-muted">En proceso: <strong className="text-foreground">{apps.filter((a) => a.status === 'draft' || a.status === 'ready').length}</strong></span>
          <span className="text-fg-muted">Rechazadas: <strong className="text-foreground">{apps.filter((a) => a.status === 'rejected').length}</strong></span>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {loading ? (
          <p className="text-sm text-fg-muted">Cargando postulaciones…</p>
        ) : apps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent elev-1 mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
                <rect x="2" y="7" width="20" height="14" rx="2" />
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
              </svg>
            </div>
            <p className="text-sm font-medium">Sin postulaciones todavía</p>
            <p className="mt-1 max-w-sm text-xs text-fg-muted">
              Andá a <a href="/ofertas" className="text-accent hover:underline">Ofertas</a> y postulate a alguna oferta. Acá vas a ver el seguimiento.
            </p>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
            {apps.map((app) => {
              const status = STATUS_LABELS[app.status];
              const next = NEXT_STATUSES[app.status];
              const expanded = expandedId === app.id;
              return (
                <article key={app.id} className="fade-up rounded-xl border border-border bg-elevated/40 transition-colors hover:bg-elevated/70">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : app.id)}
                    className="w-full px-4 py-4 text-left"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <h3 className="text-sm font-semibold leading-tight text-foreground">{app.job.title}</h3>
                          <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent">
                            {app.job.platformSlug}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-fg-muted">
                          {app.job.company ?? 'Empresa confidencial'}{app.job.location ? ` · ${app.job.location}` : ''}
                        </p>
                        <p className="mt-1 text-[10px] text-fg-muted">
                          Postulada el {formatDate(app.preparedAt ?? app.createdAt)}
                          {app.submittedAt && ` · Enviada el ${formatDate(app.submittedAt)}`}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${toneClasses(status.tone)}`}>
                          {status.label}
                        </span>
                        <span className="text-[10px] text-fg-muted">
                          {expanded ? '▲ ocultar' : '▼ detalle'}
                        </span>
                      </div>
                    </div>
                  </button>

                  {expanded && (
                    <div className="border-t border-border px-4 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {app.job.url && (
                          <a
                            href={app.job.url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs text-fg-muted transition-colors hover:border-accent/40 hover:text-foreground"
                          >
                            Ver oferta original
                          </a>
                        )}
                        {next.length > 0 && (
                          <>
                            <span className="text-xs text-fg-muted">Cambiar estado:</span>
                            {next.map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => changeStatus(app.id, s)}
                                disabled={updatingId === app.id}
                                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${toneClasses(STATUS_LABELS[s].tone)}`}
                              >
                                {updatingId === app.id ? '…' : STATUS_LABELS[s].label}
                              </button>
                            ))}
                          </>
                        )}
                      </div>
                      {app.events.length > 0 && (
                        <div className="mt-4">
                          <p className="mb-2 text-xs uppercase tracking-wider text-fg-muted">Historial</p>
                          <ul className="space-y-1.5">
                            {app.events.map((ev) => (
                              <li key={ev.id} className="flex items-start gap-2 text-xs text-fg-muted">
                                <span className="mt-1 inline-block h-1 w-1 flex-shrink-0 rounded-full bg-accent" />
                                <span className="flex-1">
                                  <span className="text-foreground">{ev.message}</span>
                                  <span className="ml-2 opacity-60">{formatDate(ev.occurredAt)}</span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
