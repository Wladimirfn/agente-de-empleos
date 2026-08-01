import { db } from '@employment-agent/database';
import { candidateProfiles, chatMessages, chatMemoryFacts, chatSummaries } from '@employment-agent/database/schema';
import type { ChatMessage as LLMChatMessage } from '@employment-agent/llm';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';

export const DEFAULT_CONVERSATION_ID = 'default';
export const MAX_HISTORY_TURNS = 20;

export interface PersistedMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

/**
 * Return the id of the active candidate profile, or null if none is set.
 * The agent is single-user for now — when a profile is missing we still
 * persist messages but tied to a sentinel id so the transcript isn't lost.
 */
async function resolveProfileId(): Promise<number> {
  const rows = await db.select().from(candidateProfiles).limit(1);
  return rows[0]?.id ?? 0;
}

export async function getRecentMessages(
  conversationId: string = DEFAULT_CONVERSATION_ID,
  limit = MAX_HISTORY_TURNS,
): Promise<PersistedMessage[]> {
  const profileId = await resolveProfileId();
  if (profileId === 0) return [];

  const rows = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.profileId, profileId), eq(chatMessages.conversationId, conversationId)))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);

  return rows.reverse().map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    createdAt: r.createdAt,
  }));
}

export async function appendMessage(args: {
  role: 'user' | 'assistant';
  content: string;
  conversationId?: string;
  provider?: string | null;
  model?: string | null;
}): Promise<PersistedMessage> {
  const profileId = await resolveProfileId();
  if (profileId === 0) {
    // No profile yet — refuse silently rather than crashing the chat.
    return { id: -1, role: args.role, content: args.content, createdAt: new Date().toISOString() };
  }
  const rows = await db
    .insert(chatMessages)
    .values({
      profileId,
      conversationId: args.conversationId ?? DEFAULT_CONVERSATION_ID,
      role: args.role,
      content: args.content,
      provider: args.provider ?? null,
      model: args.model ?? null,
    })
    .returning();
  const r = rows[0];
  return { id: r.id, role: r.role, content: r.content, createdAt: r.createdAt };
}

/**
 * Convert the persisted history into the multi-turn shape the LLM expects.
 * Drops any non user/assistant/system roles defensively (the schema enforces
 * user/assistant but future-proof the API).
 */
export function toLLMMessages(history: PersistedMessage[]): LLMChatMessage[] {
  return history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));
}

// ----- Memory facts -----

export interface MemoryFact {
  id: number;
  category: 'preference' | 'decision' | 'personal' | 'job-context' | 'other';
  fact: string;
  source: 'manual' | 'extracted' | 'inferred';
  importance: number;
  createdAt: string;
  updatedAt: string;
}

export async function listFacts(): Promise<MemoryFact[]> {
  const profileId = await resolveProfileId();
  if (profileId === 0) return [];
  const rows = await db
    .select()
    .from(chatMemoryFacts)
    .where(eq(chatMemoryFacts.profileId, profileId))
    .orderBy(desc(chatMemoryFacts.importance), asc(chatMemoryFacts.updatedAt));
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    fact: r.fact,
    source: r.source,
    importance: r.importance,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function addFact(args: {
  fact: string;
  category?: MemoryFact['category'];
  importance?: number;
  source?: MemoryFact['source'];
}): Promise<MemoryFact> {
  const profileId = await resolveProfileId();
  if (profileId === 0) throw new Error('No hay perfil cargado todavía.');
  const rows = await db
    .insert(chatMemoryFacts)
    .values({
      profileId,
      category: args.category ?? 'other',
      fact: args.fact,
      source: args.source ?? 'manual',
      importance: args.importance ?? 5,
    })
    .returning();
  const r = rows[0];
  return {
    id: r.id,
    category: r.category,
    fact: r.fact,
    source: r.source,
    importance: r.importance,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function deleteFact(id: number): Promise<boolean> {
  const profileId = await resolveProfileId();
  if (profileId === 0) return false;
  const rows = await db
    .delete(chatMemoryFacts)
    .where(and(eq(chatMemoryFacts.id, id), eq(chatMemoryFacts.profileId, profileId)))
    .returning();
  return rows.length > 0;
}

export async function clearAllFacts(): Promise<number> {
  const profileId = await resolveProfileId();
  if (profileId === 0) return 0;
  const rows = await db
    .delete(chatMemoryFacts)
    .where(eq(chatMemoryFacts.profileId, profileId))
    .returning();
  return rows.length;
}

/**
 * Format memory facts for injection into the system prompt. Sorted by
 * importance descending so the most relevant facts land first.
 */
export function formatFactsForPrompt(facts: MemoryFact[]): string {
  if (facts.length === 0) return '';
  const lines = facts.map((f) => `- [${f.category}] ${f.fact}`);
  return `## Memoria persistente del candidato (hechos confirmados)

Estos datos fueron confirmados por el candidato o extraídos de conversaciones previas. NO los pidas de nuevo y usalos como contexto en todo lo que respondas.

${lines.join('\n')}
`;
}

// ----- Compaction -----

export interface ChatSummary {
  id: number;
  conversationId: string;
  summary: string;
  turnsCovered: number;
  startMessageId: number;
  endMessageId: number;
  tokensBefore: number;
  model: string | null;
  createdAt: string;
}

export async function listSummaries(
  conversationId: string = DEFAULT_CONVERSATION_ID,
): Promise<ChatSummary[]> {
  const profileId = await resolveProfileId();
  if (profileId === 0) return [];
  const rows = await db
    .select()
    .from(chatSummaries)
    .where(and(eq(chatSummaries.profileId, profileId), eq(chatSummaries.conversationId, conversationId)))
    .orderBy(asc(chatSummaries.createdAt));
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    summary: r.summary,
    turnsCovered: r.turnsCovered,
    startMessageId: r.startMessageId,
    endMessageId: r.endMessageId,
    tokensBefore: r.tokensBefore,
    model: r.model,
    createdAt: r.createdAt,
  }));
}

export async function saveSummary(args: {
  summary: string;
  turnsCovered: number;
  startMessageId: number;
  endMessageId: number;
  tokensBefore: number;
  model?: string | null;
  conversationId?: string;
}): Promise<ChatSummary> {
  const profileId = await resolveProfileId();
  if (profileId === 0) throw new Error('No hay perfil cargado todavía.');
  const rows = await db
    .insert(chatSummaries)
    .values({
      profileId,
      conversationId: args.conversationId ?? DEFAULT_CONVERSATION_ID,
      summary: args.summary,
      turnsCovered: args.turnsCovered,
      startMessageId: args.startMessageId,
      endMessageId: args.endMessageId,
      tokensBefore: args.tokensBefore,
      model: args.model ?? null,
    })
    .returning();
  const r = rows[0];
  return {
    id: r.id,
    conversationId: r.conversationId,
    summary: r.summary,
    turnsCovered: r.turnsCovered,
    startMessageId: r.startMessageId,
    endMessageId: r.endMessageId,
    tokensBefore: r.tokensBefore,
    model: r.model,
    createdAt: r.createdAt,
  };
}

export async function deleteSummary(id: number): Promise<boolean> {
  const profileId = await resolveProfileId();
  if (profileId === 0) return false;
  const rows = await db
    .delete(chatSummaries)
    .where(and(eq(chatSummaries.id, id), eq(chatSummaries.profileId, profileId)))
    .returning();
  return rows.length > 0;
}

/**
 * Build the conversation context the LLM should see for a given conversation.
 * If compaction has happened, the older messages are gone from `chat_messages`
 * perspective — instead, the leading summary is injected as a synthetic
 * "system" turn before the recent verbatim history.
 */
export async function buildContextForLLM(
  conversationId: string = DEFAULT_CONVERSATION_ID,
): Promise<{ messages: LLMChatMessage[]; summaries: ChatSummary[]; recentCount: number }> {
  const [summaries, recent] = await Promise.all([
    listSummaries(conversationId),
    getRecentMessages(conversationId, MAX_HISTORY_TURNS),
  ]);

  const recentLLM = toLLMMessages(recent);

  if (summaries.length === 0) {
    return { messages: recentLLM, summaries: [], recentCount: recent.length };
  }

  // The most recent summary supersedes all older ones; keep only the latest.
  // Older summaries are kept in DB for audit but not loaded into context.
  const latest = summaries[summaries.length - 1];
  const summaryTurn: LLMChatMessage = {
    role: 'system',
    content: `Resumen de la conversación previa con el candidato (${latest.turnsCovered} turnos compactados, ${latest.tokensBefore} tokens):\n\n${latest.summary}`,
  };

  return {
    messages: [summaryTurn, ...recentLLM],
    summaries: [latest],
    recentCount: recent.length,
  };
}

/**
 * Compaction pass: take older messages, ask the LLM to summarize them,
 * store the summary in `chat_summaries`, and delete the messages that the
 * summary now covers. The caller decides which messages to compact via
 * `messagesToCompact`.
 *
 * Why delete? chat_messages is the verbatim log; once a summary covers a
 * range, the rows in that range become redundant for context purposes.
 * Keeping them would just bloat the table over time. The summary keeps
 * the conversation reconstructable.
 */
export async function applyCompaction(args: {
  messagesToCompact: PersistedMessage[];
  summary: string;
  tokensBefore: number;
  model?: string | null;
  conversationId?: string;
}): Promise<ChatSummary | null> {
  if (args.messagesToCompact.length === 0) return null;
  const profileId = await resolveProfileId();
  if (profileId === 0) return null;

  const startId = args.messagesToCompact[0].id;
  const endId = args.messagesToCompact[args.messagesToCompact.length - 1].id;
  if (typeof startId !== 'number' || typeof endId !== 'number' || startId < 0 || endId < 0) return null;

  // Order matters: insert summary first, then delete the covered rows. If
  // the insert fails, we still have the verbatim rows — no information lost.
  const summary = await saveSummary({
    summary: args.summary,
    turnsCovered: args.messagesToCompact.length,
    startMessageId: startId,
    endMessageId: endId,
    tokensBefore: args.tokensBefore,
    model: args.model ?? null,
    conversationId: args.conversationId ?? DEFAULT_CONVERSATION_ID,
  });

  await db
    .delete(chatMessages)
    .where(and(
      eq(chatMessages.profileId, profileId),
      gte(chatMessages.id, startId),
      lte(chatMessages.id, endId),
      eq(chatMessages.conversationId, args.conversationId ?? DEFAULT_CONVERSATION_ID),
    ));

  return summary;
}
