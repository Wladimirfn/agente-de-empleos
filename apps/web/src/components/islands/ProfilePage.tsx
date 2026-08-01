import { useEffect, useState } from 'react';

interface Profile {
  id: number;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  summary: string | null;
  searchScope?: string;
}

interface Experience {
  id: number;
  role: string;
  company: string;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
}

interface Skill {
  id: number;
  name: string;
  level: string | null;
  years: number | null;
}

interface TargetRole {
  id: number;
  roleTitle: string;
  priority: number;
  isActive: boolean;
}

interface Proposal {
  id: number;
  kind: string;
  description: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [targetRoles, setTargetRoles] = useState<TargetRole[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [newRole, setNewRole] = useState('');
  const [addingRole, setAddingRole] = useState(false);
  const [searchScopes, setSearchScopes] = useState<string[]>(['local']);
  const [savingScope, setSavingScope] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [profileRes, rolesRes, proposalsRes, prefsRes] = await Promise.all([
        fetch('/api/profile'),
        fetch('/api/profile/target-roles'),
        fetch('/api/profile/proposals?status=pending'),
        fetch('/api/profile/search-preferences'),
      ]);
      const profileData = await profileRes.json();
      const rolesData = await rolesRes.json();
      const proposalsData = await proposalsRes.json();
      const prefsData = await prefsRes.json();

      if (profileData.status === 'empty') {
        setProfile(null);
      } else {
        setProfile(profileData.profile);
        setExperiences(profileData.experiences ?? []);
        setSkills(profileData.skills ?? []);
      }
      setTargetRoles(rolesData.roles ?? []);
      setProposals(proposalsData.proposals ?? []);
      setSearchScopes(prefsData.searchScopes ?? ['local']);
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleRole(role: TargetRole) {
    await fetch('/api/profile/target-roles', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: role.id, isActive: !role.isActive }),
    });
    await load();
  }

  async function removeRole(id: number) {
    if (!confirm('¿Eliminar este rol objetivo?')) return;
    await fetch(`/api/profile/target-roles?id=${id}`, { method: 'DELETE' });
    await load();
  }

  async function addRole() {
    const title = newRole.trim();
    if (!title) return;
    setAddingRole(true);
    try {
      await fetch('/api/profile/target-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleTitle: title, priority: targetRoles.length + 1 }),
      });
      setNewRole('');
      await load();
    } finally {
      setAddingRole(false);
    }
  }

  async function toggleScope(scope: string) {
    if (savingScope) return;
    const current = [...searchScopes];
    const idx = current.indexOf(scope);
    if (idx >= 0) {
      // Don't allow deselecting the last one
      if (current.length <= 1) return;
      current.splice(idx, 1);
    } else {
      current.push(scope);
    }
    setSavingScope(true);
    try {
      await fetch('/api/profile/search-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchScopes: current }),
      });
      setSearchScopes(current);
    } finally {
      setSavingScope(false);
    }
  }

  async function resolveProposal(id: number, action: 'accepted' | 'rejected') {
    setResolvingId(id);
    try {
      await fetch('/api/profile/proposals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      await load();
    } finally {
      setResolvingId(null);
    }
  }

  if (loading) return <p className="p-6 text-sm text-fg-muted">Cargando perfil…</p>;
  if (!profile) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="rounded-xl border border-border bg-elevated/40 p-8 text-center max-w-md">
          <p className="text-sm font-medium">No hay perfil cargado</p>
          <p className="mt-2 text-xs text-fg-muted">
            Subí tu CV en <a href="/curriculums" className="text-accent hover:underline">Currículums</a> para crear tu perfil.
          </p>
        </div>
      </div>
    );
  }

  const activeRoles = targetRoles.filter((r) => r.isActive);
  const inactiveRoles = targetRoles.filter((r) => !r.isActive);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border bg-background px-6 py-4">
        <h1 className="text-base font-semibold tracking-tight">Mi perfil</h1>
        <p className="mt-0.5 text-xs text-fg-muted">
          Datos del candidato, roles objetivo y propuestas pendientes.
        </p>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
        {/* Basic info */}
        <section className="rounded-xl border border-border bg-elevated/40 p-5">
          <h2 className="text-sm font-semibold text-foreground">{profile.fullName ?? 'Sin nombre'}</h2>
          <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-fg-muted sm:grid-cols-2">
            <p>Email: <span className="text-foreground">{profile.email ?? '—'}</span></p>
            <p>Teléfono: <span className="text-foreground">{profile.phone ?? '—'}</span></p>
            <p>Ubicación: <span className="text-foreground">{profile.location ?? '—'}</span></p>
          </div>
          {profile.summary && (
            <p className="mt-3 text-xs leading-relaxed text-fg-muted">{profile.summary}</p>
          )}
        </section>

        {/* Search preferences */}
        <section className="rounded-xl border border-border bg-elevated/40 p-5">
          <h2 className="text-sm font-semibold text-foreground">Preferencia de búsqueda</h2>
          <p className="mt-1 text-xs text-fg-muted">
            Dónde buscar ofertas. Podés combinar varias opciones. Se usa junto con tu ubicación ({profile.location ?? 'no definida'}).
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([
              { value: 'local', label: 'Mi ciudad', desc: 'Solo en tu ubicación' },
              { value: 'national', label: 'Mi país', desc: 'Todo Chile' },
              { value: 'international', label: 'Internacional', desc: 'Sin filtro de país' },
              { value: 'remote', label: 'Remoto', desc: 'Solo trabajo online' },
            ] as const).map((opt) => {
              const active = searchScopes.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleScope(opt.value)}
                  disabled={savingScope || (active && searchScopes.length <= 1)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    active
                      ? 'border-accent/50 bg-accent/10 text-foreground'
                      : 'border-border bg-elevated/20 text-fg-muted hover:border-accent/30 hover:text-foreground'
                  } disabled:opacity-50`}
                >
                  <p className="text-xs font-medium">
                    {active ? '✓ ' : ''}{opt.label}
                  </p>
                  <p className="mt-0.5 text-[10px] opacity-70">{opt.desc}</p>
                </button>
              );
            })}
          </div>
        </section>

        {/* Target roles */}
        <section className="rounded-xl border border-border bg-elevated/40 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Roles objetivo</h2>
            <span className="text-xs text-fg-muted">{activeRoles.length} activos</span>
          </div>
          <p className="mt-1 text-xs text-fg-muted">
            Los roles activos se usan para ordenar las ofertas en /ofertas.
          </p>

          {activeRoles.length > 0 && (
            <div className="mt-3 space-y-2">
              {activeRoles.map((role) => (
                <div key={role.id} className="flex items-center justify-between rounded-lg border border-accent/20 bg-accent/5 px-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-accent">
                      {role.priority}
                    </span>
                    <span className="text-sm text-foreground">{role.roleTitle}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleRole(role)}
                      className="rounded border border-border px-2 py-1 text-xs text-fg-muted hover:text-foreground"
                    >
                      Pausar
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRole(role.id)}
                      className="rounded border border-danger/30 px-2 py-1 text-xs text-danger hover:bg-danger/10"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {inactiveRoles.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs uppercase tracking-wider text-fg-muted">Pausados</p>
              {inactiveRoles.map((role) => (
                <div key={role.id} className="flex items-center justify-between rounded-lg border border-border bg-elevated/20 px-3 py-2 opacity-60">
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted/20 text-xs font-bold text-fg-muted">
                      {role.priority}
                    </span>
                    <span className="text-sm text-fg-muted">{role.roleTitle}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleRole(role)}
                      className="rounded border border-accent/30 px-2 py-1 text-xs text-accent hover:bg-accent/10"
                    >
                      Activar
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRole(role.id)}
                      className="rounded border border-danger/30 px-2 py-1 text-xs text-danger hover:bg-danger/10"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add new role */}
          <div className="mt-4 flex gap-2">
            <input
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRole(); } }}
              placeholder="Agregar rol objetivo (ej: Jefe de Mantención)"
              className="flex-1 rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-foreground placeholder:text-fg-muted focus:border-accent/50 focus:outline-none"
            />
            <button
              type="button"
              onClick={addRole}
              disabled={addingRole || newRole.trim() === ''}
              className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-background hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Agregar
            </button>
          </div>
        </section>

        {/* Pending proposals */}
        {proposals.length > 0 && (
          <section className="rounded-xl border border-warn/30 bg-warn/5 p-5">
            <h2 className="text-sm font-semibold text-foreground">Propuestas pendientes ({proposals.length})</h2>
            <p className="mt-1 text-xs text-fg-muted">
              La IA propuso estos cambios. Aceptalos o rechazalos.
            </p>
            <div className="mt-4 space-y-3">
              {proposals.map((p) => (
                <div key={p.id} className="rounded-lg border border-border bg-elevated/40 p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{p.kind.replace('_', ' ')}</p>
                  <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">{p.description}</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => resolveProposal(p.id, 'accepted')}
                      disabled={resolvingId === p.id}
                      className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {resolvingId === p.id ? 'Aplicando…' : 'Aceptar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => resolveProposal(p.id, 'rejected')}
                      disabled={resolvingId === p.id}
                      className="rounded-lg border border-danger/30 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Rechazar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Experience */}
        {experiences.length > 0 && (
          <section className="rounded-xl border border-border bg-elevated/40 p-5">
            <h2 className="text-sm font-semibold text-foreground">Experiencia ({experiences.length})</h2>
            <div className="mt-3 space-y-3">
              {experiences.map((e) => (
                <div key={e.id} className="rounded-lg border border-border/50 p-3">
                  <p className="text-sm font-medium text-foreground">{e.role} — {e.company}</p>
                  <p className="text-xs text-fg-muted">
                    {e.startDate ?? '?'} → {e.endDate ?? 'actual'}
                  </p>
                  {e.description && <p className="mt-1 text-xs text-fg-muted">{e.description}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Skills */}
        {skills.length > 0 && (
          <section className="rounded-xl border border-border bg-elevated/40 p-5">
            <h2 className="text-sm font-semibold text-foreground">Skills ({skills.length})</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {skills.map((s) => (
                <span key={s.id} className="inline-flex items-center rounded-full border border-border bg-elevated px-3 py-1 text-xs">
                  {s.name}{s.years ? ` (${s.years}a)` : ''}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
