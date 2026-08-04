import { useEffect, useState } from 'react';

interface CredentialSummary {
  slug: string;
  hasEmail: boolean;
  hasStorageState: boolean;
  lastLoginAt: string | null;
  lastLoginStatus: string;
  consentAt: string;
  updatedAt: string;
}

const KNOWN_SLUGS = [
  { slug: 'indeed', label: 'Indeed Chile' },
  { slug: 'laborum', label: 'Laborum.cl' },
  { slug: 'computrabajo', label: 'Computrabajo.cl' },
  { slug: 'chiletrabajos', label: 'Chiletrabajos.cl' },
  { slug: 'empleosaqua', label: 'Empleos Aqua' },
  { slug: 'trabajando', label: 'Trabajando.cl' },
];

export default function CredentialsSection() {
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/credentials');
      const data = await res.json() as { credentials: CredentialSummary[] };
      setCredentials(data.credentials);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

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

  const knownWithStatus = KNOWN_SLUGS.map((k) => ({
    ...k,
    credential: credentials.find((c) => c.slug === k.slug),
  }));

  return (
    <div className="space-y-6 p-6">
      <section className="rounded-lg border border-border bg-background/40 p-4">
        <h3 className="mb-3 text-sm font-semibold">Cargar credencial</h3>
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
                {KNOWN_SLUGS.map((k) => (
                  <option key={k.slug} value={k.slug}>{k.label}</option>
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
                      ? `Email: ${k.credential.hasEmail ? 'guardado' : '—'} · Último login: ${k.credential.lastLoginAt ?? 'nunca'} (${k.credential.lastLoginStatus})`
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
    </div>
  );
}
