import { useEffect, useState } from 'react';

interface MatchedJob {
  id: number;
  externalId: string;
  platformSlug: string;
  title: string;
  company?: string;
  location?: string;
  url?: string;
  description?: string;
  score: number;
  reasoning?: string;
  breakdown?: {
    skillsMatch: number;
    experienceMatch: number;
    locationMatch: number;
    seniorityMatch: number;
  };
  applied: boolean;
}

function scoreColor(score: number): string {
  if (score >= 75) return 'bg-accent';
  if (score >= 50) return 'bg-warn';
  return 'bg-muted/50';
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'excelente fit';
  if (score >= 65) return 'buen fit';
  if (score >= 50) return 'posible';
  return 'bajo fit';
}

const SCORE_FILTERS = [
  { label: 'Todos', min: 0 },
  { label: '>50', min: 50 },
  { label: '>70', min: 70 },
  { label: '>80', min: 80 },
];

const PAGE_SIZE = 10;

const INTERVAL_OPTIONS = [
  { value: 15, label: 'cada 15 min' },
  { value: 30, label: 'cada 30 min' },
  { value: 60, label: 'cada 1 hora' },
  { value: 120, label: 'cada 2 horas' },
  { value: 240, label: 'cada 4 horas' },
  { value: 720, label: 'cada 12 horas' },
  { value: 1440, label: 'cada 24 horas' },
];

export default function JobSearch() {
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [jobs, setJobs] = useState<MatchedJob[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(true);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [minScore, setMinScore] = useState(0);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [autoScanEnabled, setAutoScanEnabled] = useState(true);
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [scanSaving, setScanSaving] = useState(false);
  const [scanSaved, setScanSaved] = useState(false);

  useEffect(() => {
    fetch('/api/settings/scan')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setIntervalMinutes(data.intervalMinutes ?? 30);
          setAutoScanEnabled(data.autoScanEnabled !== false);
        }
      })
      .catch(() => {});
  }, []);

  async function saveScanSettings(enabled: boolean, minutes: number) {
    setScanSaving(true);
    setScanSaved(false);
    try {
      const res = await fetch('/api/settings/scan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervalMinutes: minutes, autoScanEnabled: enabled }),
      });
      if (res.ok) {
        setScanSaved(true);
        setTimeout(() => setScanSaved(false), 2000);
      }
    } catch {
      // silencioso: el worker seguirá con el valor anterior
    } finally {
      setScanSaving(false);
    }
  }

  useEffect(() => {
    fetch('/api/jobs/matches?limit=50')
      .then((r) => (r.ok ? r.json() : { jobs: [] }))
      .then((data) => {
        setJobs(data.jobs ?? []);
      })
      .catch(() => {})
      .finally(() => setLoadingMatches(false));
  }, []);

  useEffect(() => {
    fetch('/api/jobs/suggest')
      .then((r) => (r.ok ? r.json() : { suggestions: [] }))
      .then((data) => {
        setSuggestions(data.suggestions ?? []);
      })
      .catch(() => {})
      .finally(() => setLoadingSuggestions(false));
  }, []);

  async function search(event?: React.FormEvent) {
    event?.preventDefault();
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/jobs/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, location: location.trim() || undefined, limit: 30 }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? 'La búsqueda falló.');
        return;
      }
      setJobs(data.jobs ?? []);
    } catch {
      setError('No se pudo contactar al servidor.');
    } finally {
      setLoading(false);
    }
  }

  async function apply(jobId: number) {
    if (applyingId !== null) return;
    setApplyingId(jobId);
    try {
      const response = await fetch('/api/jobs/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      const data = await response.json();
      if (response.ok) {
        setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, applied: true } : j)));
      } else {
        alert(data.error ?? 'No se pudo registrar la postulación.');
      }
    } catch {
      alert('No se pudo contactar al servidor.');
    } finally {
      setApplyingId(null);
    }
  }

  function useSuggestion(text: string) {
    setQuery(text);
    // Trigger the search immediately with the suggested text.
    setLoading(true);
    setError(null);
    fetch('/api/jobs/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: text, limit: 30 }),
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          setError(data.error ?? 'La búsqueda falló.');
          return;
        }
        setJobs(data.jobs ?? []);
      })
      .catch(() => setError('No se pudo contactar al servidor.'))
      .finally(() => setLoading(false));
  }

  const filteredJobs = jobs.filter((j) => j.score >= minScore);
  const visibleJobs = filteredJobs.slice(0, visibleCount);
  const hasMore = filteredJobs.length > visibleCount;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border bg-background px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-base font-semibold tracking-tight">Ofertas</h1>
            <p className="mt-0.5 text-xs text-fg-muted">
              Buscá ofertas reales, el agente las ordena por fit con tu perfil.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="auto-scan-interval" className="text-xs text-fg-muted">
              Búsqueda automática
            </label>
            <select
              id="auto-scan-interval"
              disabled={scanSaving}
              value={autoScanEnabled ? String(intervalMinutes) : 'off'}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'off') {
                  setAutoScanEnabled(false);
                  void saveScanSettings(false, intervalMinutes);
                } else {
                  const minutes = Number(val);
                  setAutoScanEnabled(true);
                  setIntervalMinutes(minutes);
                  void saveScanSettings(true, minutes);
                }
              }}
              className="rounded-lg border border-border bg-elevated px-2 py-1.5 text-xs text-foreground focus:border-accent/50 focus:outline-none disabled:opacity-50"
            >
              {INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.value} value={String(opt.value)}>{opt.label}</option>
              ))}
              {autoScanEnabled && !INTERVAL_OPTIONS.some((o) => o.value === intervalMinutes) && (
                <option value={String(intervalMinutes)}>cada {intervalMinutes} min</option>
              )}
              <option value="off">desactivada</option>
            </select>
            {scanSaved && <span className="text-xs text-accent">✓</span>}
          </div>
        </div>
      </div>

      {/* Suggestions */}
      {!loadingSuggestions && suggestions.length > 0 && (
        <div className="flex-shrink-0 border-b border-border bg-background px-6 py-3">
          <p className="mb-2 text-xs uppercase tracking-wider text-fg-muted">Sugerencias para tu perfil</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => useSuggestion(s)}
                disabled={loading}
                className="rounded-full border border-border bg-elevated px-3 py-1.5 text-xs text-fg-muted transition-colors hover:border-accent/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search bar */}
      <form onSubmit={search} className="flex-shrink-0 border-b border-border bg-background px-6 py-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cargo o skill (ej: jefe de mantención, técnico en frío…)"
            className="flex-1 rounded-xl border border-border bg-elevated px-4 py-2.5 text-sm text-foreground placeholder:text-fg-muted focus:border-accent/50 focus:outline-none"
          />
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Ubicación (opcional, ej: Puerto Montt)"
            className="rounded-xl border border-border bg-elevated px-4 py-2.5 text-sm text-foreground placeholder:text-fg-muted focus:border-accent/50 focus:outline-none sm:w-56"
          />
          <button
            type="submit"
            disabled={loading || query.trim() === ''}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40 elev-1"
          >
            {loading ? 'Buscando…' : 'Buscar'}
          </button>
        </div>
      </form>

      {/* Score filter */}
      <div className="flex-shrink-0 border-b border-border bg-background px-6 py-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-fg-muted">
            {filteredJobs.length} de {jobs.length} ofertas
          </p>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-elevated/40 p-1">
            {SCORE_FILTERS.map((f) => (
              <button
                key={f.label}
                type="button"
                onClick={() => {
                  setMinScore(f.min);
                  setVisibleCount(PAGE_SIZE);
                }}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  minScore === f.min
                    ? 'bg-accent text-background'
                    : 'text-fg-muted hover:text-foreground'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {error && (
          <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}
        {/* Info banner when all results are low-fit (likely no maintenance jobs in sources) */}
        {filteredJobs.length > 0 && filteredJobs.every((j) => j.score < 40) && (
          <div className="mb-4 rounded-lg border border-warn/30 bg-warn/5 px-4 py-3 text-xs text-warn">
            <p className="font-medium">No hay ofertas de mantención/refrigeración en las fuentes actuales.</p>
            <p className="mt-1">
              GetOnboard y Arbeitnow son portales tech. Para traer ofertas de tu rubro necesitamos conectar Laborum, Computrabajo o Indeed (browser skills). Mientras tanto, estas son las ofertas disponibles aunque no calzan con tu perfil.
            </p>
          </div>
        )}
        {loadingMatches ? (
          <p className="text-sm text-fg-muted">Cargando matches…</p>
        ) : filteredJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent elev-1 mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
                <rect x="2" y="7" width="20" height="14" rx="2" />
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
              </svg>
            </div>
            <p className="text-sm font-medium">{jobs.length === 0 ? 'Sin matches todavía' : 'Ninguna oferta cumple el filtro'}</p>
            <p className="mt-1 max-w-sm text-xs text-fg-muted">
              {jobs.length === 0
                ? 'Escribí un cargo arriba o tocá una sugerencia. El agente trae ofertas reales y las ordena por fit con tu perfil.'
                : 'Bajá el umbral de score o probá otra búsqueda.'}
            </p>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
            <p className="text-xs text-fg-muted">
              Mostrando {visibleJobs.length} de {filteredJobs.length} ofertas ordenadas por fit · fuentes: GetOnboard + Arbeitnow
            </p>
            {visibleJobs.map((job) => (
              <article key={job.id} className="fade-up rounded-xl border border-border bg-elevated/40 p-4 transition-colors hover:bg-elevated/70">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <h3 className="text-sm font-semibold leading-tight text-foreground">{job.title}</h3>
                      <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent">
                        {job.platformSlug}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-fg-muted">
                      {job.company ?? 'Empresa confidencial'}{job.location ? ` · ${job.location}` : ''}
                    </p>
                    {job.description && (
                      <p className="mt-2 line-clamp-2 text-xs text-fg-muted leading-relaxed">
                        {job.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}
                      </p>
                    )}
                    {job.reasoning && (
                      <p className="mt-2 rounded-md bg-accent/5 px-2 py-1.5 text-[11px] italic text-accent/90">
                        {job.reasoning}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full ${scoreColor(job.score)}`} />
                      <span className="text-xs font-semibold">{Math.round(job.score)}</span>
                      <span className="text-[10px] text-fg-muted">{scoreLabel(job.score)}</span>
                    </div>
                    {job.breakdown && (
                      <div className="text-right text-[10px] text-fg-muted">
                        <p>skills {Math.round(job.breakdown.skillsMatch)}</p>
                        <p>exp {Math.round(job.breakdown.experienceMatch)}</p>
                        <p>ubicación {Math.round(job.breakdown.locationMatch)}</p>
                      </div>
                    )}
                    <div className="flex gap-2">
                      {job.url && (
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-border bg-elevated px-3 py-1.5 text-xs text-fg-muted transition-colors hover:border-accent/40 hover:text-foreground"
                        >
                          Ver oferta
                        </a>
                      )}
                      {job.applied ? (
                        <span className="rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent">
                          Postulada
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => apply(job.id)}
                          disabled={applyingId === job.id}
                          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {applyingId === job.id ? 'Postulando…' : 'Postular'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            ))}
            {hasMore && (
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="rounded-lg border border-border bg-elevated px-4 py-2 text-xs font-medium text-fg-muted transition-colors hover:border-accent/40 hover:text-foreground"
              >
                Cargar más ({filteredJobs.length - visibleCount} restantes)
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
