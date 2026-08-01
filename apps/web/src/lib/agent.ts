import type { LLMProvider } from '@employment-agent/llm';
import { createConfiguredProvider, createLLMProvider, hasProviderCredential } from '@employment-agent/llm';
import { db } from '@employment-agent/database';
import { llmSettings } from '@employment-agent/database/schema';

export interface AgentStatus {
  provider: string;
  model: string | null;
  source: 'settings' | 'env' | 'none';
  hasKey: boolean;
  active: boolean;
}

export interface ActiveAgent {
  provider: LLMProvider;
  status: AgentStatus;
}

/**
 * Resolve the active provider: persisted settings win, then env vars, then the
 * deterministic stub. `active` is only true when a non-stub provider could be
 * built from real credentials/config — the stub is never claimed as active.
 */
export async function getActiveAgent(): Promise<ActiveAgent> {
  const rows = await db.select().from(llmSettings).limit(1);
  const row = rows[0];
  if (row) {
    const provider = createConfiguredProvider({ provider: row.provider, model: row.model, baseUrl: row.baseUrl });
    return {
      provider,
      status: {
        provider: row.provider,
        model: row.model,
        source: 'settings',
        hasKey: hasProviderCredential(row.provider),
        active: provider.name !== 'stub',
      },
    };
  }
  const envProvider = process.env.LLM_PROVIDER ?? 'stub';
  if (envProvider !== 'stub') {
    const provider = createLLMProvider();
    return {
      provider,
      status: {
        provider: envProvider,
        model: provider.model ?? null,
        source: 'env',
        hasKey: hasProviderCredential(envProvider),
        active: provider.name !== 'stub',
      },
    };
  }
  return {
    provider: createLLMProvider(),
    status: { provider: 'stub', model: null, source: 'none', hasKey: false, active: false },
  };
}
