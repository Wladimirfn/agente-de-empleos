import { useEffect, useState } from 'react';

interface Platform {
  id: number;
  slug: string;
  displayName: string;
  baseUrl: string | null;
  status: string;
  lastScanAt: string | null;
  jobsFound: number;
  matchesFound: number;
  healthStatus: string;
  healthCheckedAt: string | null;
  totalFailures: number;
  unrepairedFailures: number;
}

const HEALTH_LABELS: Record<string, { label: string; color: string }> = {
  healthy: { label: 'Saludable', color: 'text-success' },
  degraded: { label: 'Degradada', color: 'text-warn' },
  broken: { label: 'Rota', color: 'text-danger' },
  'needs-human': { label: 'Necesita humano', color: 'text-warn' },
  unknown: { label: 'Sin verificar', color: 'text-fg-muted' },
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active: { label: 'Activa', color: 'bg-success/20 text-success' },
  paused: { label: 'Pausada', color: 'bg-warn/20 text-warn' },
  disabled: { label: 'Desactivada', color: 'bg-danger/20 text-danger' },
};

function timeAgo(iso: string | null): string {
  if (!iso) return 'nunca';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `hace ${days}d`;
}

export default function PlatformsPage() {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  async function scanPlatform(slug: string, mode: 'skill' | 'agent' = 'skill') {
    setScanning(slug);
    setScanMessage(null);
    try {
      const res = await fetch('/api/platforms/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, mode }),
      });
      const data = await res.json();
      if (data.scanned) {
        setScanMessage(`${slug}: ${data.jobsNew} nuevas de ${data.jobsFound} encontradas.`);
      } else if (data.message) {
        setScanMessage(data.message);
      } else if (data.error) {
        setScanMessage(`Error: ${data.error}`);
      }
      // Refresh after a short delay to pick up results
      setTimeout(() => { load(); setScanMessage(null); }, 5000);
    } catch {
      setScanMessage('Error de red al escanear.');
    } finally {
      setScanning(null);
    }
  }
  async function load() {
    try {
      const res = await fetch('/api/platforms');
      const data = await res.json();
      setPlatforms(data.platforms ?? []);
    } catch {
      setPlatforms([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  if (loading) return <p className="p-6 text-sm text-fg-muted">Cargando plataformas…</p>;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex-shrink-0 border-b border-border bg-background px-6 py-4">
        <h1 className="text-base font-semibold tracking-tight">Plataformas</h1>
        <p className="mt-0.5 text-xs text-fg-muted">
          Portales configurados para monitoreo. Se actualizan cada 30 segundos.
        </p>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-6">
        {scanMessage && (
          <div className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-xs text-foreground">
            {scanMessage}
          </div>
        )}
        {platforms.length === 0 && (
          <div className="rounded-xl border border-border bg-elevated/40 p-8 text-center">
            <p className="text-sm text-fg-muted">No hay plataformas registradas.</p>
          </div>
        )}

        {platforms.map((p) => {
          const status = STATUS_LABELS[p.status] ?? STATUS_LABELS.active!;
          const health = HEALTH_LABELS[p.healthStatus] ?? HEALTH_LABELS.unknown!;
          return (
            <div key={p.id} className="rounded-xl border border-border bg-elevated/40 p-5">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-semibold text-foreground">{p.displayName}</h2>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${status.color}`}>
                    {status.label}
                  </span>
                </div>
                {p.baseUrl && (
                  <a
                    href={p.baseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-accent hover:underline"
                  >
                    {p.baseUrl.replace(/^https?:\/\//, '')}
                  </a>
                )}
              </div>

              {/* Stats grid */}
              <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-fg-muted">Último escaneo</p>
                  <p className="mt-0.5 text-sm text-foreground">{timeAgo(p.lastScanAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-fg-muted">Ofertas</p>
                  <p className="mt-0.5 text-sm text-foreground">{p.jobsFound}</p>
                </div>
                <div>
                  <p className="text-xs text-fg-muted">Compatibles</p>
                  <p className="mt-0.5 text-sm text-foreground">{p.matchesFound}</p>
                </div>
                <div>
                  <p className="text-xs text-fg-muted">Salud skill</p>
                  <p className={`mt-0.5 text-sm font-medium ${health.color}`}>
                    {health.label}
                  </p>
                </div>
              </div>

              {/* Failures warning */}
              {p.unrepairedFailures > 0 && (
                <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2">
                  <p className="text-xs text-danger">
                    {p.unrepairedFailures} falla{p.unrepairedFailures > 1 ? 's' : ''} sin reparar
                    {p.totalFailures > p.unrepairedFailures && ` (${p.totalFailures} total)`}
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="mt-4 flex items-center gap-2 border-t border-border/50 pt-3">
                <button
                  type="button"
                  className="rounded-lg border border-accent/30 px-3 py-1.5 text-xs text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
                  disabled={scanning === p.slug}
                  onClick={() => scanPlatform(p.slug, 'skill')}
                >
                  {scanning === p.slug ? 'Escaneando…' : 'Escanear ahora'}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-warn/30 px-3 py-1.5 text-xs text-warn hover:bg-warn/10 transition-colors disabled:opacity-50"
                  disabled={scanning === p.slug}
                  onClick={() => scanPlatform(p.slug, 'agent')}
                  title="El LLM abre un navegador y busca manualmente"
                >
                  Agente LLM
                </button>
                <a
                  href={`/ofertas/todas?platform=${p.slug}`}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted hover:text-foreground transition-colors"
                >
                  Ver ofertas ({p.jobsFound})
                </a>
                <a
                  href={`/skills?platform=${p.slug}`}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-fg-muted hover:text-foreground transition-colors"
                >
                  Ver skill
                </a>
                {p.status === 'active' ? (
                  <button
                    type="button"
                    className="rounded-lg border border-warn/30 px-3 py-1.5 text-xs text-warn hover:bg-warn/10 transition-colors"
                    onClick={() => alert('Pausar plataforma — próximamente.')}
                  >
                    Pausar
                  </button>
                ) : (
                  <button
                    type="button"
                    className="rounded-lg border border-accent/30 px-3 py-1.5 text-xs text-accent hover:bg-accent/10 transition-colors"
                    onClick={() => alert('Activar plataforma — próximamente.')}
                  >
                    Activar
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
