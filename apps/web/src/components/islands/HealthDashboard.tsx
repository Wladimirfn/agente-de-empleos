import { useEffect, useState } from 'react';
import type { HealthResponse, SkillHealthSummary, SkillStatus } from '../../lib/health-types.js';
import { formatRelative } from '../../lib/format.js';

const POLL_MS = 5000;

const statusBadgeClass: Record<SkillStatus, string> = {
  healthy: 'bg-green-500/20 text-green-300 border-green-500/30',
  degraded: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  broken: 'bg-red-500/20 text-red-300 border-red-500/30',
  'needs-human': 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  unknown: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

const statusLabel: Record<SkillStatus, string> = {
  healthy: 'Saludable',
  degraded: 'Degradada',
  broken: 'Rota',
  'needs-human': 'Requiere humano',
  unknown: 'Sin datos',
};

interface SkillRowProps {
  skill: SkillHealthSummary;
}

function SkillRow({ skill }: SkillRowProps) {
  const needsAttention = skill.unrepairedFailures > 0 || skill.latestStatus === 'broken' || skill.latestStatus === 'needs-human';
  return (
    <div className="rounded border border-border bg-background/40 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-foreground">{skill.skillSlug}</h3>
          {skill.platformDisplayName && (
            <p className="text-sm text-muted mt-0.5">
              {skill.platformDisplayName}
              {skill.platformStatus && skill.platformStatus !== 'active' && (
                <span className="ml-2 text-xs">· plataforma {skill.platformStatus}</span>
              )}
            </p>
          )}
        </div>
        <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${statusBadgeClass[skill.latestStatus]}`}>
          {statusLabel[skill.latestStatus]}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
        <div>
          <dt className="text-muted text-xs">Último healthcheck</dt>
          <dd className="text-foreground">{formatRelative(skill.latestCheckedAt)}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Último éxito</dt>
          <dd className="text-foreground">{formatRelative(skill.lastSuccessAt)}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Fallas consecutivas</dt>
          <dd className={skill.consecutiveFailures > 0 ? 'text-red-400' : 'text-foreground'}>
            {skill.consecutiveFailures}
          </dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Fallas 24h</dt>
          <dd className={skill.failuresLast24h > 0 ? 'text-yellow-400' : 'text-foreground'}>
            {skill.failuresLast24h}
          </dd>
        </div>
      </dl>

      {skill.unrepairedFailures > 0 && (
        <p className="mt-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {skill.unrepairedFailures} falla{skill.unrepairedFailures === 1 ? '' : 's'} sin reparar · requiere revisión humana
        </p>
      )}

      {!skill.hasData && (
        <p className="mt-3 text-xs text-muted">
          El worker aún no corrió esta skill. Levantá <code className="text-accent">npm run dev:worker</code>.
        </p>
      )}
      {needsAttention && skill.hasData && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="rounded border border-border bg-background/60 px-3 py-1 text-xs hover:bg-muted/10"
            disabled
            title="Disponible cuando se implemente el flujo de reparación manual"
          >
            Marcar como revisada
          </button>
          <button
            type="button"
            className="rounded px-3 py-1 text-xs text-muted hover:text-foreground hover:bg-muted/10"
            disabled
            title="Disponible cuando se implemente el editor de skills"
          >
            Editar skill
          </button>
        </div>
      )}
    </div>
  );
}

export default function HealthDashboard() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const fetchOnce = async () => {
      try {
        const res = await fetch('/api/health');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as HealthResponse;
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };

    fetchOnce();
    timer = setInterval(fetchOnce, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  if (error) {
    return (
      <div className="rounded border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
        Error al cargar el estado de las skills: {error}
      </div>
    );
  }

  if (!data) {
    return <p className="text-muted text-sm">Cargando estado de skills…</p>;
  }

  if (data.skills.length === 0) {
    return (
      <div className="rounded border border-border bg-background/40 p-6 text-center">
        <p className="text-foreground font-medium">No hay skills instaladas todavía</p>
        <p className="mt-2 text-sm text-muted">
          Las skills se registran automáticamente cuando el worker arranca.
          Iniciá el worker con <code className="text-accent">npm run dev:worker</code> o registrá una plataforma manualmente.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="health-dashboard">
      {data.skills.map((skill) => (
        <SkillRow key={skill.skillSlug} skill={skill} />
      ))}
    </div>
  );
}