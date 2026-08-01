import { useEffect, useState } from 'react';

interface JobWithFeedback {
  id: number;
  externalId: string;
  title: string;
  company: string | null;
  location: string | null;
  url: string | null;
  description: string | null;
  platformSlug: string;
  platformName: string;
  score: number | null;
  breakdown: {
    skillsMatch: number;
    experienceMatch: number;
    locationMatch: number;
    seniorityMatch: number;
  } | null;
  reasoning: string | null;
  feedback: 'compatible' | 'not_compatible' | null;
  feedbackNote: string | null;
  firstSeenAt: string;
}

function scoreBadge(score: number | null): { label: string; color: string } {
  if (score === null) return { label: 'Sin puntaje', color: 'bg-muted/20 text-fg-muted' };
  if (score >= 80) return { label: `${Math.round(score)}%`, color: 'bg-accent/20 text-accent' };
  if (score >= 65) return { label: `${Math.round(score)}%`, color: 'bg-warn/20 text-warn' };
  if (score >= 50) return { label: `${Math.round(score)}%`, color: 'bg-warn/10 text-warn' };
  return { label: `${Math.round(score)}%`, color: 'bg-danger/20 text-danger' };
}

export default function JobsBrowser({ platformFilter }: { platformFilter?: string }) {
  const [jobs, setJobs] = useState<JobWithFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'scored' | 'compatible' | 'not_compatible' | 'no_feedback'>('all');
  const [feedbackLoading, setFeedbackLoading] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const params = platformFilter ? `?platform=${platformFilter}` : '';
      const res = await fetch(`/api/jobs/feedback${params}`);
      const data = await res.json();
      setJobs(data.jobs ?? []);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [platformFilter]);

  async function submitFeedback(jobId: number, verdict: 'compatible' | 'not_compatible') {
    setFeedbackLoading(jobId);
    try {
      await fetch('/api/jobs/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, verdict }),
      });
      // Update local state
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, feedback: verdict } : j)),
      );
    } finally {
      setFeedbackLoading(null);
    }
  }

  const filtered = jobs.filter((j) => {
    if (filter === 'scored') return j.score !== null;
    if (filter === 'compatible') return j.feedback === 'compatible';
    if (filter === 'not_compatible') return j.feedback === 'not_compatible';
    if (filter === 'no_feedback') return j.feedback === null;
    return true;
  });

  const scoredCount = jobs.filter((j) => j.score !== null).length;
  const compatibleCount = jobs.filter((j) => j.feedback === 'compatible').length;
  const notCompatibleCount = jobs.filter((j) => j.feedback === 'not_compatible').length;

  if (loading) return <p className="p-6 text-sm text-fg-muted">Cargando ofertas…</p>;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex-shrink-0 border-b border-border bg-background px-6 py-4">
        <h1 className="text-base font-semibold tracking-tight">
          Ofertas{platformFilter ? ` — ${platformFilter}` : ''}
        </h1>
        <p className="mt-0.5 text-xs text-fg-muted">
          {jobs.length} ofertas · {scoredCount} puntuadas · {compatibleCount} compatibles · {notCompatibleCount} descartadas
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex-shrink-0 border-b border-border/50 bg-background/50 px-6 py-2">
        <div className="flex gap-1">
          {([
            { key: 'all', label: `Todas (${jobs.length})` },
            { key: 'scored', label: `Puntuadas (${scoredCount})` },
            { key: 'compatible', label: `Compatibles (${compatibleCount})` },
            { key: 'not_compatible', label: `Descartadas (${notCompatibleCount})` },
            { key: 'no_feedback', label: 'Sin revisar' },
          ] as const).map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                filter === f.key
                  ? 'bg-accent/20 text-accent font-medium'
                  : 'text-fg-muted hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-4">
        {filtered.length === 0 && (
          <div className="rounded-xl border border-border bg-elevated/40 p-8 text-center">
            <p className="text-sm text-fg-muted">No hay ofertas con este filtro.</p>
          </div>
        )}

        {filtered.map((job) => {
          const badge = scoreBadge(job.score);
          const expanded = expandedId === job.id;
          return (
            <div
              key={job.id}
              className={`rounded-xl border p-4 transition-colors ${
                job.feedback === 'compatible'
                  ? 'border-accent/30 bg-accent/5'
                  : job.feedback === 'not_compatible'
                    ? 'border-danger/20 bg-danger/5 opacity-60'
                    : 'border-border bg-elevated/40'
              }`}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${badge.color}`}>
                      {badge.label}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-fg-muted">
                      {job.platformName}
                    </span>
                  </div>
                  <h3 className="mt-1 text-sm font-medium text-foreground leading-snug">
                    {job.url ? (
                      <a href={job.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">
                        {job.title}
                      </a>
                    ) : job.title}
                  </h3>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {job.company ?? '—'}{job.location ? ` · ${job.location}` : ''}
                  </p>
                </div>

                {/* Feedback buttons */}
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    disabled={feedbackLoading === job.id}
                    onClick={() => submitFeedback(job.id, 'compatible')}
                    className={`rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
                      job.feedback === 'compatible'
                        ? 'bg-accent text-background'
                        : 'border border-accent/30 text-accent hover:bg-accent/10'
                    } disabled:opacity-50`}
                    title="Es compatible"
                  >
                    ✓ Compatible
                  </button>
                  <button
                    type="button"
                    disabled={feedbackLoading === job.id}
                    onClick={() => submitFeedback(job.id, 'not_compatible')}
                    className={`rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
                      job.feedback === 'not_compatible'
                        ? 'bg-danger text-background'
                        : 'border border-danger/30 text-danger hover:bg-danger/10'
                    } disabled:opacity-50`}
                    title="No es compatible"
                  >
                    ✗ No es
                  </button>
                </div>
              </div>

              {/* Reasoning toggle */}
              {job.reasoning && (
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : job.id)}
                  className="mt-2 text-xs text-fg-muted hover:text-foreground transition-colors"
                >
                  {expanded ? '▾ Ocultar análisis' : '▸ Ver análisis del LLM'}
                </button>
              )}

              {expanded && job.reasoning && (
                <div className="mt-2 rounded-lg border border-border/50 bg-elevated/20 p-3">
                  <p className="text-xs text-fg-muted leading-relaxed">{job.reasoning}</p>
                  {job.breakdown && (
                    <div className="mt-2 grid grid-cols-4 gap-2">
                      {Object.entries(job.breakdown).map(([key, val]) => (
                        <div key={key} className="text-center">
                          <p className="text-[10px] uppercase tracking-wider text-fg-muted">
                            {key.replace('Match', '')}
                          </p>
                          <p className="text-sm font-medium text-foreground">{Math.round(val)}%</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
