import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import { llmSettings } from '../src/schema/llm-settings.js';

const migration = readFileSync(
  new URL('../../../drizzle/migrations/0001_llm_settings.sql', import.meta.url),
  'utf8',
);

describe('llm_settings schema', () => {
  it('defines metadata columns without a raw secret column', () => {
    const columns = getTableConfig(llmSettings).columns.map((column) => column.name);

    expect(columns).toEqual([
      'id',
      'provider',
      'model',
      'base_url',
      'api_key_target',
      'updated_at',
    ]);
    expect(columns).not.toContain('api_key');
  });

  it('persists only configuration metadata in SQLite', async () => {
    const client = createClient({ url: ':memory:' });
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) await client.execute(statement);
    }
    await client.execute({
      sql: `INSERT INTO llm_settings (id, provider, model, base_url, api_key_target)
            VALUES (1, ?, ?, ?, ?)`,
      args: ['openai', 'gpt-4o-mini', null, 'employment-agent/llm/openai'],
    });

    const secret = ['raw', 'secret', 'value'].join('-');
    await expect(client.execute({
      sql: 'UPDATE llm_settings SET api_key = ? WHERE id = 1',
      args: [secret],
    })).rejects.toThrow();

    const result = await client.execute('SELECT * FROM llm_settings');
    expect(result.rows[0]).toMatchObject({
      id: 1,
      provider: 'openai',
      model: 'gpt-4o-mini',
      api_key_target: 'employment-agent/llm/openai',
    });
    expect(JSON.stringify(result.rows)).not.toContain(secret);
    await client.close();
  });
});
