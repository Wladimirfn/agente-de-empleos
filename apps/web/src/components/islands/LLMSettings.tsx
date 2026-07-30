import { useEffect, useState } from 'react';
import { SUPPORTED_LLM_PROVIDERS, type LLMProviderName } from '../../lib/llm-settings.js';

type LoadState = 'loading' | 'not-configured' | 'configured' | 'saving' | 'saved' | 'error';

const labels: Record<LLMProviderName, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini', ollama: 'Ollama',
  minimax: 'MiniMax', kimi: 'Kimi', llamacpp: 'llama.cpp', stub: 'Deterministic stub',
};

export default function LLMSettings() {
  const [provider, setProvider] = useState<LLMProviderName>('stub');
  const [model, setModel] = useState('stub');
  const [baseUrl, setBaseUrl] = useState('');
  const [state, setState] = useState<LoadState>('loading');
  const [message, setMessage] = useState('Loading settings…');

  useEffect(() => {
    fetch('/api/settings/llm')
      .then(async (response) => {
        if (!response.ok) throw new Error('Settings service unavailable');
        return response.json();
      })
      .then((data) => {
        if (data.status === 'not-configured') {
          setState('not-configured');
          setMessage('No LLM provider is configured. The deterministic stub remains the safe fallback.');
          return;
        }
        setProvider(data.settings.provider);
        setModel(data.settings.model);
        setBaseUrl(data.settings.baseUrl ?? '');
        setState('configured');
        setMessage('Configuration metadata loaded. Worker restart is required after changes.');
      })
      .catch(() => {
        setState('error');
        setMessage('Settings could not be loaded. No provider is claimed as active.');
      });
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setState('saving');
    setMessage('Saving configuration metadata…');
    try {
      const response = await fetch('/api/settings/llm', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model, baseUrl }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Save failed');
      setState('saved');
      setMessage('Metadata saved. Restart the worker to apply it. Credentials are not configured.');
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Settings could not be saved.');
    }
  }

  return (
    <section className="mt-6 max-w-2xl rounded-lg border border-border bg-background p-6">
      <form onSubmit={save} className="space-y-5">
        <label className="block text-sm font-medium">
          Provider
          <select value={provider} onChange={(event) => setProvider(event.target.value as LLMProviderName)} className="mt-2 w-full rounded border border-border bg-background px-3 py-2">
            {SUPPORTED_LLM_PROVIDERS.map((value) => <option key={value} value={value}>{labels[value]}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Model
          <input required value={model} onChange={(event) => setModel(event.target.value)} className="mt-2 w-full rounded border border-border bg-background px-3 py-2" />
        </label>
        <label className="block text-sm font-medium">
          Base URL (optional)
          <input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://localhost:11434/v1" className="mt-2 w-full rounded border border-border bg-background px-3 py-2" />
        </label>
        <div role="status" className="rounded bg-muted/10 p-3 text-sm">{message}</div>
        <div className="rounded border border-border p-3 text-sm">
          <strong>Credentials:</strong> unavailable in this foundation slice. API keys are not accepted or saved here.
        </div>
        <button type="submit" disabled={state === 'loading' || state === 'saving'} className="rounded bg-accent px-4 py-2 text-background disabled:opacity-50">
          {state === 'saving' ? 'Saving…' : 'Save metadata'}
        </button>
      </form>
    </section>
  );
}
