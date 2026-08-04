import { useEffect, useState } from 'react';

type LoginStatus = 'success' | '2fa_required' | 'login_failed' | 'no_login_form' | 'unknown';
type SessionStatus = 'pending' | 'ready' | 'completed' | 'expired' | 'failed' | 'cancelled';

interface CredentialSummary {
  slug: string;
  hasEmail: boolean;
  hasStorageState: boolean;
  lastLoginAt: string | null;
  lastLoginStatus: LoginStatus;
  consentAt: string;
  updatedAt: string;
}

interface CatalogSkill {
  slug: string;
  version: string;
  displayName: string;
  capabilities: { canScan: boolean; canApply: boolean; canDetectLoggedOut: boolean };
  source: 'production' | 'example';
}

interface SkillsPayload {
  skills: CatalogSkill[];
}

interface SessionState {
  id: string;
  slug: string;
  status: SessionStatus;
  readyAt: string | null;
  userCompletedAt: string | null;
  error: string | null;
  expiresAt: string;
}

export default function CredentialsSection() {
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [catalog, setCatalog] = useState<CatalogSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const [session, setSession] = useState<SessionState | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [credsRes, skillsRes] = await Promise.all([
        fetch('/api/settings/credentials'),
        fetch('/api/skills'),
      ]);
      const credsData = await credsRes.json() as { credentials: CredentialSummary[] };
      const skillsData = await skillsRes.json() as SkillsPayload;
      setCredentials(credsData.credentials);
      setCatalog(skillsData.skills.filter((s) => s.source === 'production'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  // Poll the session status while a capture is in flight.
  useEffect(() => {
    if (!session) return;
    if (session.status === 'completed' || session.status === 'expired' || session.status === 'failed') return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/settings/credentials/session?id=${encodeURIComponent(session.id)}`);
        const data = await res.json() as { session: SessionState };
        if (res.ok && data.session) setSession(data.session);
      } catch {
        // ignore transient errors
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [session?.id, session?.status]);

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!consent) {
      setStatus({ kind: 'err', message: 'Tenés que confirmar el consentimiento explícito.' });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch('/api/settings/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, email, password, consent: true }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) {
        setStatus({ kind: 'err', message: data.error ?? 'No se pudo guardar.' });
      } else {
        setStatus({ kind: 'ok', message: `Credencial de ${slug} guardada y cifrada.` });
        setPassword('');
        setConsent(false);
        await refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(slug: string) {
    if (!confirm(`¿Borrar la credencial de ${slug}?`)) return;
    await fetch(`/api/settings/credentials?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' });
    await refresh();
  }

  async function handleStartSession(slug: string) {
    setSessionError(null);
    setSession(null);
    try {
      const res = await fetch('/api/settings/credentials/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      const data = await res.json() as { sessionId?: string; error?: string };
      if (!res.ok || !data.sessionId) {
        setSessionError(data.error ?? 'No se pudo abrir la sesión.');
        return;
      }
      setSession({
        id: data.sessionId,
        slug,
        status: 'pending',
        readyAt: null,
        userCompletedAt: null,
        error: null,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      });
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSessionDone() {
    if (!session) return;
    try {
      await fetch(`/api/settings/credentials/session/${encodeURIComponent(session.id)}/complete`, {
        method: 'POST',
      });
    } catch {
      // The polling will pick up the worker result regardless.
    }
  }

  function handleSessionClose() {
    setSession(null);
    setSessionError(null);
    void refresh();
  }

  async function handleSessionCancel() {
    if (!session) return;
    // Tell the worker to stop polling so the headed browser closes.
    try {
      await fetch(`/api/settings/credentials/session/${encodeURIComponent(session.id)}/cancel`, {
        method: 'POST',
      });
    } catch {
      // The polling will still pick up the next server-side state.
    }
    setSession({ ...session, status: 'cancelled' });
  }

  const knownWithStatus = catalog.map((k) => ({
    slug: k.slug,
    label: k.displayName,
    credential: credentials.find((c) => c.slug === k.slug),
  }));

  return (
    <div className="space-y-6 p-6">
      <section className="rounded-lg border border-border bg-background/40 p-4">
        <h3 className="mb-3 text-sm font-semibold">Cargar credencial (login directo)</h3>
        <p className="mb-3 text-xs text-fg-muted">
          Úsalo sólo si la plataforma tiene un form de email + contraseña. Si usás Google,
          Facebook u otro OAuth, saltá a la sección de abajo y usá &quot;Capturar sesión iniciada&quot;.
        </p>
        <form className="space-y-3" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-xs">
              Plataforma
              <select
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                required
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">— elegir —</option>
                {catalog.map((k) => (
                  <option key={k.slug} value={k.slug}>{k.displayName}</option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                autoComplete="email"
              />
            </label>
          </div>
          <label className="block text-xs">
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              autoComplete="current-password"
            />
          </label>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Confirmo que quiero guardar mi email + contraseña en la base de datos local,
              cifrados con AES-GCM. El agente los va a usar únicamente en el dominio aprobado
              de la plataforma. Si la plataforma tiene 2FA, voy a tener que ingresar el código
              manualmente cuando me lo pida.
            </span>
          </label>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving || !consent}
              className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-background disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Guardar credencial'}
            </button>
            {status && (
              <span className={`text-xs ${status.kind === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
                {status.message}
              </span>
            )}
          </div>
        </form>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">Sesión iniciada (recomendado para OAuth)</h3>
        <p className="mb-3 text-xs text-fg-muted">
          Abrimos un navegador para que te loguees manualmente (Google, Facebook, 2FA, lo que
          sea). Cuando termines, tocá &quot;Listo&quot; y guardamos tus cookies cifradas.
        </p>
        <ul className="space-y-2">
          {knownWithStatus.map((k) => (
            <li key={k.slug} className="flex items-center justify-between rounded border border-border bg-background/40 px-3 py-2 text-sm">
              <div>
                <div className="font-medium">{k.label}</div>
                <div className="text-xs text-fg-muted">
                  {k.credential?.hasStorageState
                    ? 'Sesión guardada — el agente arranca logueado.'
                    : 'Sin sesión guardada'}
                </div>
              </div>
              <button
                onClick={() => handleStartSession(k.slug)}
                disabled={session?.slug === k.slug}
                className="rounded border border-accent/40 px-2 py-1 text-xs text-accent hover:bg-accent/10 disabled:opacity-50"
              >
                {session?.slug === k.slug ? 'Capturando…' : 'Capturar sesión iniciada'}
              </button>
            </li>
          ))}
        </ul>
        {sessionError && (
          <p className="mt-2 text-xs text-red-400">{sessionError}</p>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold">Credenciales cargadas</h3>
        {loading ? (
          <p className="text-xs text-fg-muted">Cargando…</p>
        ) : (
          <ul className="space-y-2">
            {knownWithStatus.map((k) => (
              <li key={k.slug} className="flex items-center justify-between rounded border border-border bg-background/40 px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{k.label}</div>
                  <div className="text-xs text-fg-muted">
                    {k.credential
                      ? `Email: ${k.credential.hasEmail ? 'guardado' : '—'} · Sesión: ${k.credential.hasStorageState ? 'guardada' : '—'} · Estado: ${k.credential.lastLoginStatus}`
                      : 'Sin credencial cargada'}
                  </div>
                </div>
                {k.credential && (
                  <button
                    onClick={() => handleDelete(k.slug)}
                    className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                  >
                    Borrar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {session && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-2xl">
            <h3 className="mb-2 text-sm font-semibold">
              Sesión iniciada en {catalog.find((k) => k.slug === session.slug)?.displayName ?? session.slug}
            </h3>
            <p className="mb-3 text-xs text-fg-muted">
              {session.status === 'pending' && 'Abriendo el navegador…'}
              {session.status === 'ready' && 'Navegador abierto. Loguéate con Google, Facebook, email, lo que sea. Toca "Listo" cuando termines.'}
              {session.status === 'completed' && 'Sesión guardada y cifrada. Cerrá esta ventana.'}
              {session.status === 'expired' && 'La sesión expiró (5 minutos). Vuelve a intentarlo.'}
              {session.status === 'failed' && `Falló: ${session.error ?? 'error desconocido'}. Probá de nuevo.`}
            </p>
            <div className="flex justify-end gap-2">
              {(session.status === 'pending' || session.status === 'ready') && (
                <>
                  <button
                    onClick={handleSessionCancel}
                    className="rounded border border-border px-3 py-1.5 text-xs hover:bg-background/40"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSessionDone}
                    disabled={session.status !== 'ready'}
                    className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
                  >
                    Listo
                  </button>
                </>
              )}
              {(session.status === 'completed' || session.status === 'expired' || session.status === 'failed') && (
                <button
                  onClick={handleSessionClose}
                  className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-background"
                >
                  Cerrar
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
