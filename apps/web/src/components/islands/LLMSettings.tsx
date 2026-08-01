import { useEffect, useState } from 'react';
import { SUPPORTED_LLM_PROVIDERS, type LLMProviderName } from '../../lib/llm-settings.js';

type LoadState = 'loading' | 'not-configured' | 'configured' | 'saving' | 'saved' | 'error';

const labels: Record<LLMProviderName, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini', groq: 'Groq', nvidia: 'NVIDIA',
  ollama: 'Ollama', minimax: 'MiniMax', kimi: 'Kimi', llamacpp: 'llama.cpp', stub: 'Deterministic stub',
};

// Providers that use a fixed cloud endpoint. Base URL is read-only for these.
const CLOUD_PROVIDERS = new Set<string>(['openai', 'anthropic', 'gemini', 'groq', 'nvidia', 'minimax', 'kimi']);

interface DiscoveredModel { id: string }

export default function LLMSettings() {
  const [provider, setProvider] = useState<LLMProviderName>('stub');
  const [model, setModel] = useState('stub');
  const [baseUrl, setBaseUrl] = useState('');
  const [state, setState] = useState<LoadState>('loading');
  const [message, setMessage] = useState('Loading settings…');
  const [hasKey, setHasKey] = useState(false);
  const [models, setModels] = useState<DiscoveredModel[]>([]);
  const [modelsSource, setModelsSource] = useState<'idle' | 'loading' | 'live' | 'fallback' | 'error'>('idle');
  const [modelsError, setModelsError] = useState<string | null>(null);

  const isLocalProvider = provider === 'ollama' || provider === 'llamacpp';
  const isModelSelectable = models.length > 0;

  // Load current settings once
  useEffect(() => {
    fetch('/api/settings/llm')
      .then(async (response) => {
        if (!response.ok) throw new Error('Settings service unavailable');
        return response.json();
      })
      .then((data) => {
        if (data.status === 'not-configured') {
          setState('not-configured');
          setMessage('No hay un proveedor configurado. El stub determinístico queda como fallback.');
          return;
        }
        setProvider(data.settings.provider);
        setModel(data.settings.model);
        setBaseUrl(data.settings.baseUrl ?? '');
        setHasKey(Boolean(data.settings.hasKey));
        setState('configured');
        setMessage('Configuración cargada. Reiniciá el worker para aplicar cambios.');
      })
      .catch(() => {
        setState('error');
        setMessage('No se pudo cargar la configuración.');
      });
  }, []);

  // Discover models when provider changes
  useEffect(() => {
    if (provider === 'stub') {
      setModels([{ id: 'stub' }]);
      setModelsSource('live');
      setModelsError(null);
      return;
    }
    setModelsSource('loading');
    setModelsError(null);
    setModels([]);
    const controller = new AbortController();
    fetch(`/api/settings/llm/models?provider=${encodeURIComponent(provider)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        setModels(data.models ?? []);
        setModelsSource(data.source === 'live' || data.source === 'cached' ? 'live' : 'fallback');
        if (data.error) setModelsError(data.error);
        // If current model not in the list and list is non-empty, pick the first
        if (Array.isArray(data.models) && data.models.length > 0 && !data.models.some((m: DiscoveredModel) => m.id === model)) {
          setModel(data.models[0].id);
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setModelsSource('error');
        setModelsError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [provider]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setState('saving');
    setMessage('Guardando configuración…');
    try {
      const payload: Record<string, unknown> = { provider, model };
      if (isLocalProvider) payload.baseUrl = baseUrl;
      const response = await fetch('/api/settings/llm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Save failed');
      setHasKey(Boolean(data.settings?.hasKey));
      setState('saved');
      setMessage('Configuración guardada. Reiniciá el worker para aplicar cambios.');
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar.');
    }
  }

  return (
    <section className="mt-6 max-w-2xl rounded-lg border border-border bg-background p-6">
      <form onSubmit={save} className="space-y-5">
        <label className="block text-sm font-medium">
          Proveedor
          <select value={provider} onChange={(event) => setProvider(event.target.value as LLMProviderName)} className="mt-2 w-full rounded border border-border bg-background px-3 py-2">
            {SUPPORTED_LLM_PROVIDERS.map((value) => <option key={value} value={value}>{labels[value]}</option>)}
          </select>
        </label>

        <label className="block text-sm font-medium">
          Modelo
          {isModelSelectable ? (
            <select value={model} onChange={(event) => setModel(event.target.value)} className="mt-2 w-full rounded border border-border bg-background px-3 py-2">
              {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
            </select>
          ) : (
            <input required value={model} onChange={(event) => setModel(event.target.value)} className="mt-2 w-full rounded border border-border bg-background px-3 py-2" />
          )}
          {modelsSource === 'loading' && <span className="mt-1 block text-xs text-muted">Cargando modelos…</span>}
          {modelsSource === 'live' && <span className="mt-1 block text-xs text-green-400">Modelos detectados en vivo</span>}
          {modelsSource === 'fallback' && <span className="mt-1 block text-xs text-yellow-400">No se pudieron listar modelos en vivo; usando valor por defecto{modelsError ? `: ${modelsError}` : ''}</span>}
          {modelsSource === 'error' && <span className="mt-1 block text-xs text-red-400">Error al listar modelos: {modelsError}</span>}
        </label>

        {isLocalProvider && (
          <label className="block text-sm font-medium">
            Base URL
            <input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://localhost:11434/v1" className="mt-2 w-full rounded border border-border bg-background px-3 py-2" />
          </label>
        )}
        {!isLocalProvider && provider !== 'stub' && (
          <p className="text-xs text-muted">
            Endpoint fijo del proveedor (no editable).
          </p>
        )}

        <div role="status" className="rounded bg-muted/10 p-3 text-sm">{message}</div>
        <div className="rounded border border-border p-3 text-sm">
          <strong>Credenciales para {labels[provider]}:</strong>{' '}
          {hasKey ? 'detectadas en .env' : 'no detectadas'}. Las claves se configuran en el archivo
          <code className="text-accent"> .env</code> del repositorio (ver env.example); nunca se muestran ni se editan aquí.
        </div>
        <button type="submit" disabled={state === 'loading' || state === 'saving'} className="rounded bg-accent px-4 py-2 text-background disabled:opacity-50">
          {state === 'saving' ? 'Guardando…' : 'Guardar configuración'}
        </button>
      </form>
    </section>
  );
}
