import { useState } from 'react';

type UploadResponse =
  | {
      ok: true;
      storedFilename: string;
      parsed: {
        filename: string;
        mime: string;
        charCount: number;
        truncated: boolean;
        hints: { email: string | null; phone: string | null; name: string | null };
        location: string | null;
        summary: string | null;
        experiences?: Array<{ role: string; company: string; startDate?: string | null; endDate?: string | null; description?: string | null }>;
        skills?: Array<{ name: string; years?: number | string | null }>;
        aiAnalyzed: boolean;
        fullText: string;
      };
    }
  | { ok: false; error: string };

type ConfirmResponse = { ok: true; documentId: number; profileId: number; deduped?: boolean } | { ok: false; error: string };

interface ConfirmPayload {
  storedFilename: string;
  fullName: string;
  email: string;
  phone: string;
  location: string;
  summary: string;
  experiences: Array<{ role: string; company: string; startDate?: string | null; endDate?: string | null; description?: string | null }>;
  skills: Array<{ name: string; years?: number | string | null }>;
}

const emptyConfirm: ConfirmPayload = { storedFilename: '', fullName: '', email: '', phone: '', location: '', summary: '', experiences: [], skills: [] };

export default function CvReviewForm() {
  const [step, setStep] = useState<'upload' | 'review' | 'done'>('upload');
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [parsed, setParsed] = useState<Extract<UploadResponse, { ok: true }>['parsed'] | null>(null);
  const [form, setForm] = useState<ConfirmPayload>(emptyConfirm);
  const [savedProfileId, setSavedProfileId] = useState<number | null>(null);

  const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fileInput = (e.currentTarget.elements.namedItem('file') as HTMLInputElement) ?? null;
    const file = fileInput?.files?.[0];
    if (!file) {
      setError('Elegí un archivo.');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/cvs/upload', { method: 'POST', body: fd });
      const data = (await res.json()) as UploadResponse;
      if (!data.ok) {
        setError(data.error);
        return;
      }
      setParsed(data.parsed);
      setForm({
        storedFilename: data.storedFilename,
        fullName: data.parsed.hints.name ?? '',
        email: data.parsed.hints.email ?? '',
        phone: data.parsed.hints.phone ?? '',
        location: data.parsed.location ?? '',
        summary: data.parsed.summary ?? '',
        experiences: data.parsed.experiences ?? [],
        skills: data.parsed.skills ?? [],
      });
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setConfirming(true);
    try {
      const res = await fetch('/api/cvs/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as ConfirmResponse;
      if (!data.ok) {
        setError(data.error);
        return;
      }
      setSavedProfileId(data.profileId);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirming(false);
    }
  };

  const handleReset = () => {
    setStep('upload');
    setParsed(null);
    setForm(emptyConfirm);
    setError(null);
    setSavedProfileId(null);
  };

  const updateField = (key: keyof Omit<ConfirmPayload, 'storedFilename'>) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
    };

  if (step === 'done') {
    return (
      <div className="space-y-4">
        <div className="rounded border border-green-500/30 bg-green-500/10 p-4">
          <p className="font-medium text-green-300">Perfil guardado correctamente.</p>
          {savedProfileId !== null && <p className="text-sm text-green-300/80 mt-1">profile_id = {savedProfileId}</p>}
          <p className="text-sm text-muted mt-2">
            El documento quedó registrado. Próximo paso: revisar la sección <strong>Perfil</strong>.
          </p>
        </div>
        <button type="button" onClick={handleReset} className="rounded border border-border bg-background/60 px-3 py-1.5 text-xs hover:bg-muted/10">
          Subir otro CV
        </button>
      </div>
    );
  }

  if (step === 'review' && parsed) {
    return (
      <div className="space-y-4">
        <div className="rounded border border-border bg-background/40 p-4">
          <p className="text-sm text-muted">
            Archivo: <code className="text-accent">{parsed.filename}</code> · {parsed.mime} · {parsed.charCount} caracteres
            {parsed.truncated && <span className="ml-2 text-yellow-400">(truncado)</span>}
          </p>
          {'aiAnalyzed' in parsed && parsed.aiAnalyzed && (
            <p className="mt-2 text-xs text-green-400">
              Analizado con IA: los campos fueron extraídos inteligentemente del texto del CV.
            </p>
          )}
          {'aiAnalyzed' in parsed && !parsed.aiAnalyzed && (
            <p className="mt-2 text-xs text-yellow-400">
              Sin IA activa: campos extraídos por regex. Configurá un proveedor para mejor extracción.
            </p>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-muted hover:text-foreground">Ver texto extraído</summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-border/50 bg-background/60 p-3 text-xs">
              {parsed.fullText}
            </pre>
          </details>
        </div>

        <form onSubmit={handleConfirm} className="space-y-3">
          <p className="text-sm text-muted">
            Revisá los campos. Los hints detectados aparecen pre-llenados; editalos o dejalos vacíos si no son correctos.
            <strong> Todo lo que no completes no se guarda</strong> — el sistema nunca inventa datos.
          </p>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block text-sm">
              <span className="text-foreground">Nombre completo</span>
              <input
                type="text"
                value={form.fullName}
                onChange={updateField('fullName')}
                className="mt-1 w-full rounded border border-border bg-background/60 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
            <label className="block text-sm">
              <span className="text-foreground">Email</span>
              <input
                type="email"
                value={form.email}
                onChange={updateField('email')}
                className="mt-1 w-full rounded border border-border bg-background/60 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
            <label className="block text-sm">
              <span className="text-foreground">Teléfono</span>
              <input
                type="tel"
                value={form.phone}
                onChange={updateField('phone')}
                className="mt-1 w-full rounded border border-border bg-background/60 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
            <label className="block text-sm">
              <span className="text-foreground">Ubicación</span>
              <input
                type="text"
                value={form.location}
                onChange={updateField('location')}
                placeholder="Ciudad, país"
                className="mt-1 w-full rounded border border-border bg-background/60 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="text-foreground">Resumen profesional</span>
            <textarea
              value={form.summary}
              onChange={updateField('summary')}
              rows={3}
              placeholder="Una o dos frases con tu perfil profesional. Vacío = no se guarda."
              className="mt-1 w-full rounded border border-border bg-background/60 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </label>

          {form.experiences.length > 0 && (
            <div className="space-y-2">
              <span className="text-sm text-foreground">Experiencia detectada ({form.experiences.length})</span>
              {form.experiences.map((exp, i) => (
                <div key={i} className="rounded border border-border/50 bg-background/60 p-3 text-sm">
                  <span className="text-foreground font-medium">{exp.role}</span> — <span className="text-muted">{exp.company}</span>
                  {exp.startDate && <span className="text-xs text-muted ml-2">{exp.startDate}{exp.endDate ? ` → ${exp.endDate}` : ' → actual'}</span>}
                  {exp.description && <p className="mt-1 text-xs text-muted">{exp.description}</p>}
                </div>
              ))}
            </div>
          )}

          {form.skills.length > 0 && (
            <div className="space-y-2">
              <span className="text-sm text-foreground">Skills detectados ({form.skills.length})</span>
              <div className="flex flex-wrap gap-2">
                {form.skills.map((skill, i) => (
                  <span key={i} className="inline-flex items-center rounded border border-border px-2 py-1 text-xs">
                    {skill.name}{skill.years ? ` (${skill.years}a)` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={confirming}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-slate-900 hover:bg-accent/90 disabled:opacity-50"
            >
              {confirming ? 'Guardando…' : 'Guardar perfil'}
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded border border-border bg-background/60 px-4 py-2 text-sm hover:bg-muted/10"
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <form onSubmit={handleUpload} className="space-y-3">
      <label className="block">
        <span className="text-sm font-medium text-foreground">Archivo de CV</span>
        <input
          type="file"
          name="file"
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          required
          className="mt-1 block w-full text-sm text-muted file:mr-3 file:rounded file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-900 hover:file:bg-accent/90"
        />
        <span className="mt-1 block text-xs text-muted">PDF, DOCX o TXT. Máximo 10 MB.</span>
      </label>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>
      )}

      <button
        type="submit"
        disabled={uploading}
        className="rounded bg-accent px-4 py-2 text-sm font-medium text-slate-900 hover:bg-accent/90 disabled:opacity-50"
      >
        {uploading ? 'Subiendo…' : 'Subir y analizar'}
      </button>
    </form>
  );
}