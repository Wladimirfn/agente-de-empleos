import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Unique per-process temp DB so each vitest worker (and each rerun) gets
// isolated state. libsql's bare `:memory:` is shared across connections
// in the same process, which causes cross-file contamination under
// vitest's parallel workers.
const tempRoot = mkdtempSync(join(tmpdir(), `ea-mem-${randomUUID()}-`));
process.env.DATABASE_PATH = join(tempRoot, 'memory.db');
process.env.STORAGE_PATH = join(tempRoot, 'storage');

describe.sequential ??= () => {};

// Dynamic imports so the env vars above are picked up by the database module.
const { db, runMigrations, closeDb } = await import('@employment-agent/database');
const { candidateProfiles, chatMemoryFacts } = await import('@employment-agent/database/schema');
const { chatMessages } = await import('@employment-agent/database/schema');
const {
  addFact,
  appendMessage,
  applyCompaction,
  buildContextForLLM,
  clearAllFacts,
  deleteFact,
  formatFactsForPrompt,
  getRecentMessages,
  listFacts,
  listSummaries,
  saveSummary,
  toLLMMessages,
} = await import('./agent-memory.js');

beforeEach(async () => {
  await runMigrations();
  await db.delete(chatMessages);
  await db.delete(chatMemoryFacts);
  await db.delete(candidateProfiles);
  await db.insert(candidateProfiles).values({ fullName: 'Eric Flores', email: 'e@x.com' });
});

afterAll(async () => {
  await closeDb();
});

describe.sequential('agent-memory', () => {
  describe('messages', () => {
    it('persists user + assistant turns and reads them back in chronological order', async () => {
      await appendMessage({ role: 'user', content: 'hola', provider: null, model: null });
      await appendMessage({ role: 'assistant', content: 'buenas', provider: 'openai', model: 'gpt-4o-mini' });
      await appendMessage({ role: 'user', content: '¿me ayudás?' });

      const history = await getRecentMessages();
      expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
      expect(history.map((m) => m.content)).toEqual(['hola', 'buenas', '¿me ayudás?']);
    });

    it('respects a custom conversationId', async () => {
      await appendMessage({ role: 'user', content: 'en A', conversationId: 'A' });
      await appendMessage({ role: 'user', content: 'en B', conversationId: 'B' });

      const a = await getRecentMessages('A');
      const b = await getRecentMessages('B');
      expect(a.map((m) => m.content)).toEqual(['en A']);
      expect(b.map((m) => m.content)).toEqual(['en B']);
    });

    it('returns rows in chronological order regardless of insert order', async () => {
      await appendMessage({ role: 'user', content: 'primero' });
      await appendMessage({ role: 'assistant', content: 'segundo' });
      const history = await getRecentMessages();
      expect(history[0].content).toBe('primero');
      expect(history[1].content).toBe('segundo');
    });

    it('converts to LLM message shape with valid roles only', async () => {
      await appendMessage({ role: 'user', content: 'q' });
      await appendMessage({ role: 'assistant', content: 'a' });
      const history = await getRecentMessages();
      const llm = toLLMMessages(history);
      expect(llm).toEqual([
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'a' },
      ]);
    });
  });

  describe('facts', () => {
    it('adds, lists and deletes memory facts', async () => {
      const f1 = await addFact({ fact: 'Vive en Punta Arenas', category: 'personal', importance: 8 });
      const f2 = await addFact({ fact: 'Quiere quedarse en refrigeración industrial', category: 'decision', importance: 9 });

      const all = await listFacts();
      expect(all.length).toBe(2);
      expect(all.map((f) => f.fact).sort()).toEqual([
        'Quiere quedarse en refrigeración industrial',
        'Vive en Punta Arenas',
      ]);
      expect(all[0].importance).toBeGreaterThanOrEqual(all[1].importance);

      const removed = await deleteFact(f1.id);
      expect(removed).toBe(true);
      const after = await listFacts();
      expect(after.length).toBe(1);
      expect(after[0].id).toBe(f2.id);
    });

    it('clearAllFacts removes every fact for the active profile', async () => {
      await addFact({ fact: 'a' });
      await addFact({ fact: 'b' });
      await addFact({ fact: 'c' });
      const removed = await clearAllFacts();
      expect(removed).toBe(3);
      expect((await listFacts()).length).toBe(0);
    });

    it('formats facts into a prompt block with category tags', async () => {
      await addFact({ fact: 'Vive en Punta Arenas', category: 'personal' });
      const facts = await listFacts();
      const block = formatFactsForPrompt(facts);
      expect(block).toContain('Memoria persistente del candidato');
      expect(block).toContain('[personal]');
      expect(block).toContain('Vive en Punta Arenas');
    });

    it('returns empty prompt block when no facts exist', async () => {
      const facts = await listFacts();
      expect(formatFactsForPrompt(facts)).toBe('');
    });
  });

  describe('compaction', () => {
    it('compacts older messages into a summary and removes the rows', async () => {
      await appendMessage({ role: 'user', content: 'turno 1 usuario' });
      await appendMessage({ role: 'assistant', content: 'turno 1 asesor' });
      await appendMessage({ role: 'user', content: 'turno 2 usuario' });
      await appendMessage({ role: 'assistant', content: 'turno 2 asesor' });
      const before = await getRecentMessages();
      const startId = before[0].id;
      const endId = before[1].id;

      await applyCompaction({
        messagesToCompact: before.slice(0, 2),
        summary: 'Resumen: usuario preguntó X, asesor respondió Y.',
        tokensBefore: 100,
        model: 'MiniMax-M3',
      });

      const after = await getRecentMessages();
      expect(after.length).toBe(2);
      expect(after.map((m) => m.content)).toEqual(['turno 2 usuario', 'turno 2 asesor']);
      const summaries = await listSummaries();
      expect(summaries.length).toBe(1);
      expect(summaries[0].startMessageId).toBe(startId);
      expect(summaries[0].endMessageId).toBe(endId);
      expect(summaries[0].tokensBefore).toBe(100);
    });

    it('builds context that prepends the latest summary before recent turns', async () => {
      await appendMessage({ role: 'user', content: 'hola viejo' });
      await appendMessage({ role: 'assistant', content: 'hola viejo respuesta' });
      await appendMessage({ role: 'user', content: 'hola nuevo' });
      await appendMessage({ role: 'assistant', content: 'hola nuevo respuesta' });

      const all = await getRecentMessages();
      await applyCompaction({
        messagesToCompact: all.slice(0, 2),
        summary: 'El candidato se presentó y preguntó por ofertas.',
        tokensBefore: 80,
      });

      const ctx = await buildContextForLLM();
      expect(ctx.summaries.length).toBe(1);
      expect(ctx.messages[0].role).toBe('system');
      expect(ctx.messages[0].content).toContain('Resumen de la conversación previa');
      expect(ctx.messages[0].content).toContain('El candidato se presentó');
      expect(ctx.messages[ctx.messages.length - 2].content).toBe('hola nuevo');
      expect(ctx.messages[ctx.messages.length - 1].content).toBe('hola nuevo respuesta');
    });

    it('keeps only the latest summary in active context when multiple exist', async () => {
      await appendMessage({ role: 'user', content: 'a' });
      await appendMessage({ role: 'assistant', content: 'a2' });
      const first = await getRecentMessages();
      await applyCompaction({
        messagesToCompact: first,
        summary: 'resumen uno',
        tokensBefore: 10,
      });

      await appendMessage({ role: 'user', content: 'b' });
      await appendMessage({ role: 'assistant', content: 'b2' });
      await appendMessage({ role: 'user', content: 'c' });
      await appendMessage({ role: 'assistant', content: 'c2' });
      const second = await getRecentMessages();
      await applyCompaction({
        messagesToCompact: second,
        summary: 'resumen dos',
        tokensBefore: 20,
      });

      const all = await listSummaries();
      expect(all.length).toBe(2);
      const ctx = await buildContextForLLM();
      expect(ctx.summaries.length).toBe(1);
      expect(ctx.summaries[0].summary).toBe('resumen dos');
    });

    it('returns just the recent messages when no summaries exist', async () => {
      await appendMessage({ role: 'user', content: 'a' });
      await appendMessage({ role: 'assistant', content: 'b' });
      const ctx = await buildContextForLLM();
      expect(ctx.summaries.length).toBe(0);
      expect(ctx.messages.map((m) => m.content)).toEqual(['a', 'b']);
    });

    it('saveSummary throws when no profile is loaded', async () => {
      await db.delete(chatMemoryFacts);
      await db.delete(chatMessages);
      await db.delete(candidateProfiles);
      await expect(
        saveSummary({
          summary: 'x',
          turnsCovered: 1,
          startMessageId: 1,
          endMessageId: 1,
          tokensBefore: 1,
        }),
      ).rejects.toThrow(/perfil/);
    });
  });
});
