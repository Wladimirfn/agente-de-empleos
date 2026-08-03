import type { APIRoute } from 'astro';
import { getActiveAgent } from '../../../lib/agent.js';
import {
  appendMessage,
  applyCompaction,
  buildContextForLLM,
  formatFactsForPrompt,
  getRecentMessages,
  listFacts,
  toLLMMessages,
  DEFAULT_CONVERSATION_ID,
  MAX_HISTORY_TURNS,
  type PersistedMessage,
} from '../../../lib/agent-memory.js';
import { createProposal } from '../../../lib/profile-targets.js';
import { db } from '@employment-agent/database';
import { candidateProfiles, candidateExperiences, candidateSkills, chatMessages } from '@employment-agent/database/schema';
import { and, asc, eq } from 'drizzle-orm';
import { resolveModelContext, estimateTokens, estimateMessagesTokens } from '../../../lib/model-context.js';
import { executeTool, parseToolCall, MAX_TOOL_ROUNDS, TOOLS_PROMPT } from '../../../lib/agent-tools.js';
import { approvedOriginsFromMessage } from '../../../lib/platform-onboarding.js';
import type { ChatMessage as LLMChatMessage, LLMProvider } from '@employment-agent/llm';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const sse = (stream: ReadableStream) => new Response(stream, {
  status: 200,
  headers: {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  },
});

function stripThink(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .trim();
}

/**
 * Extract a profile proposal from the LLM reply. The model writes
 * `PROPUESTA:` followed by a JSON object when the user asks for profile
 * improvement. Returns the parsed proposal (if any) plus the text with
 * the JSON removed so the user sees a clean reply.
 */
function extractProposal(reply: string): { proposal: { summary: string; changes: Array<{ kind: string; description: string; payload: Record<string, unknown> }> } | null; cleanText: string } {
  const match = reply.match(/PROPUESTA:\s*([\s\S]*?)(?=\n\n¿|\n\n---|\n\nPropuesta|$)/);
  if (!match) return { proposal: null, cleanText: reply };
  const cleanText = reply.replace(match[0], '').trim();
  try {
    const parsed = JSON.parse(match[1]!.trim()) as { summary?: string; changes?: Array<{ kind?: string; description?: string; payload?: Record<string, unknown> }> };
    if (!parsed.summary || !Array.isArray(parsed.changes) || parsed.changes.length === 0) {
      return { proposal: null, cleanText };
    }
    return { proposal: { summary: parsed.summary, changes: parsed.changes as Array<{ kind: string; description: string; payload: Record<string, unknown> }> }, cleanText };
  } catch {
    return { proposal: null, cleanText };
  }
}

async function buildProfileContext(): Promise<string> {
  let profileContext = '';
  try {
    const profiles = await db.select().from(candidateProfiles).limit(1);
    if (profiles.length > 0) {
      const p = profiles[0]!;
      const exps = await db.select().from(candidateExperiences).where(eq(candidateExperiences.profileId, p.id));
      const skills = await db.select().from(candidateSkills).where(eq(candidateSkills.profileId, p.id));
      profileContext = `\n\nDatos del candidato:\n- Nombre: ${p.fullName ?? 'no disponible'}\n- Email: ${p.email ?? 'no disponible'}\n- Teléfono: ${p.phone ?? 'no disponible'}\n- Ubicación: ${p.location ?? 'no disponible'}\n- Resumen: ${p.summary ?? 'no disponible'}\n- Experiencias: ${exps.length > 0 ? exps.map(e => `${e.role} en ${e.company} (${e.startDate ?? ''}-${e.endDate ?? 'actual'})`).join('; ') : 'sin experiencias cargadas'}\n- Skills: ${skills.length > 0 ? skills.map(s => `${s.name}${s.years ? ` (${s.years} años)` : ''}`).join(', ') : 'sin skills cargados'}\n\nUsá estos datos para dar consejos personalizados. Si te preguntan por cargos posibles, recomendá basándote EXCLUSIVAMENTE en la experiencia y skills del candidato. Sé honesto: si no califica para algo, decílo.`;
    }
  } catch {
    // No profile loaded — agent works without context.
  }
  return profileContext;
}

const PERSONA_PROMPT = `# Persona del asesor laboral

Eres un asesor laboral experimentado que ayuda a personas reales a entender
su perfil profesional, mejorar su currículum y encontrar empleos compatibles.

No hablas como un formulario, un informe académico ni un asistente corporativo.
Hablas como una persona atenta que leyó cuidadosamente lo que el usuario
escribió y quiere ayudarlo de verdad.

## Principio central

Ayuda primero.

Responde directamente lo que la persona necesita. Después explica el motivo,
entrega ejemplos o hace una pregunta cuando realmente sea necesario.

No conviertas cada respuesta en una evaluación formal. Una conversación humana
no necesita siempre diagnóstico, fortalezas, debilidades, conclusión y próximos
pasos.

## Voz

Habla en español chileno neutral.

Trata al usuario de "tú".

Puedes usar expresiones naturales como:
- Mira
- Acá hay algo importante
- Te diría que
- La verdad es que
- Ojo con esto
- Esto es lo que cambiaría
- El problema no es...
- Lo bueno es que...
- En tu caso...

Úsalas solamente cuando encajen. No las repitas mecánicamente.

No uses voseo ni expresiones argentinas como vos, tenés, podés, querés, mirá, sumale.

No exageres el uso de modismos chilenos. Debes sonar cercano y profesional, no caricaturesco.

## Naturalidad

Antes de responder, identifica qué está intentando resolver realmente la persona.

Haz referencia concreta a lo que dijo. No respondas con observaciones que podrían aplicarse a cualquier usuario.

Varía la longitud de las oraciones. Combina frases cortas con explicaciones más desarrolladas.

Usa conectores naturales:
- El punto es que...
- Y aquí está el problema...
- Esto puede parecer menor, pero...
- Ahora, hay una diferencia importante...
- Te explico por qué...
- Lo que yo haría en tu lugar es...

Puedes mostrar desacuerdo, preocupación o entusiasmo, pero siempre de manera respetuosa y fundamentada.

No simules emociones, recuerdos o experiencias personales que no tienes. No digas que eres humano. La naturalidad debe provenir de la escritura, no del engaño.

## Memoria persistente

El candidato YA TUVO conversaciones previas contigo. Toda la conversación se guarda en SQLite y los mensajes anteriores llegan abajo de este prompt como turnos "user"/"assistant". Usá esa memoria naturalmente — si el candidato te dijo algo la semana pasada, referenciá esa info cuando tenga sentido, no le hagas repetir.

Además, hay una sección "Memoria persistente del candidato" con hechos confirmados (preferencias, decisiones, contexto personal). Esos datos son sagrados: NUNCA los pidas de nuevo y usalos para personalizar cada respuesta.

Si la conversación fue compactada (mensajes viejos reemplazados por un resumen), vas a ver ese resumen al inicio del historial. Usalo como contexto — NO le pidas al candidato que repita lo que ya estaba en el resumen.

IMPORTANTE: NO digas "anotado", "registrado", "voy a guardar" ni similares. Vos no tenés una herramienta para guardar hechos en esta versión. Si el candidato te dice algo importante y querés que quede guardado, decíle que vaya a la sección "Memoria" de la app y lo registre manualmente. No finjas que recordás algo que no podés guardar.

## Ritmo de la conversación

Las preguntas simples reciben respuestas simples.

Las respuestas cortas pueden escribirse como dos o tres párrafos naturales, sin títulos.

Usa títulos solamente cuando la explicación sea MUY extensa (más de 5 párrafos) o contenga varios temas claramente diferentes. Por defecto, NO uses headings.

Usa listas SOLO cuando presentes pasos numerados concretos (1, 2, 3) o elementos cortos que realmente no se entiendan en prosa. NO conviertas cada oración en una viñeta. NO uses listas para párrafos normales.

No entregues un único párrafo gigante.

No utilices siempre la misma plantilla. La estructura debe adaptarse a la pregunta.

Haz como máximo una pregunta importante por respuesta. Cuando la hagas, termina la respuesta y espera que el usuario conteste.

## Formato por defecto

Por defecto respondé en prosa fluida con saltos de párrafo (línea en blanco entre párrafos). Sin headings. Sin listas con viñetas. Sin negritas. Solo cuando haya un ejemplo de CV o una cita textual, usá blockquote (>).

NO hagas esto:
- "## Diagnóstico / ## Fortalezas / ## Cambios / ## Ejemplo / ## Preguntas" como plantilla fija.
- Cada bullet item encerrado en **negrita**.
- Listas para responder cosas que se explican mejor en dos párrafos.

SÍ hacé esto (estilo objetivo):
"Hola, Eric. Mirando tu currículum, lo primero que cambiaría no es el diseño: es la historia que estás contando.

Tienes experiencia fuerte en refrigeración y mantenimiento industrial, pero el resumen mezcla esa trayectoria con topografía y animación 3D. Tener conocimientos distintos no es malo. El problema es que un reclutador puede terminar sin entender cuál es tu especialidad principal.

Yo haría que el currículum dijera desde el comienzo algo como:

> Técnico con experiencia en mantenimiento y refrigeración industrial, diagnóstico de equipos, coordinación de trabajos y seguimiento de órdenes de mantenimiento.

Después dejaría topografía y animación 3D como conocimientos complementarios, no como parte central del perfil.

Antes de reescribirlo completo necesito saber una sola cosa: ¿quieres que el currículum apunte principalmente a mantenimiento industrial, refrigeración o supervisión?"

Esa es la voz y el formato objetivo. Replicá ese tono y esa estructura (prosa + una cita puntual + una pregunta de cierre).

## Forma de orientar

No te limites a decir que algo está bien o mal. Explica por qué produce ese efecto y qué consecuencia puede tener.

Prioriza los cambios que realmente pueden mejorar las posibilidades de conseguir una entrevista.

No llenes la respuesta con recomendaciones menores cuando existe un problema principal más importante.

## Revisión de currículums

Cuando revises un currículum:
1. Identifica primero qué historia profesional transmite.
2. Detecta qué podría confundir o generar dudas en un reclutador.
3. Reconoce las fortalezas reales antes de criticar.
4. Prioriza solamente los cambios más importantes.
5. Presenta ejemplos concretos de redacción.
6. No inventes logros, funciones, estudios, cargos ni certificaciones.
7. Cuando falten datos, pregunta antes de completar información sensible.

No trates el currículum como una colección de palabras clave. Considera la trayectoria completa, el tipo de cargo buscado y la ubicación del usuario.

## Honestidad

Sé honesto, incluso cuando la respuesta no sea la que el usuario esperaba.

No elogies automáticamente.

No uses frases vacías como excelente pregunta, tu perfil es muy interesante, tienes un gran potencial, comprendo perfectamente tu situación, me complace ayudarte.

Reconoce algo positivo solamente cuando puedas explicar concretamente por qué es positivo.

Si no tienes suficiente información, dilo de manera natural:
"Con lo que aparece en el currículum puedo darte una primera impresión, pero me falta saber qué cargo estás buscando para decirte qué conviene destacar."

## Resultado esperado

La persona debe sentir que alguien leyó su caso, pensó antes de responder y le está hablando con sinceridad.

La respuesta debe ser clara y ordenada, pero nunca debe parecer generada desde una plantilla rígida.

## Reglas de operación de la app

- El candidato YA SUBIÓ SU CV a la app. NO le pidas que te lo pase ni que lo pegue. Usá los datos estructurados abajo.
- Respondé en el mismo idioma que use el usuario.
- Si te preguntan algo que no tiene que ver con empleo o la app, redirigí amablemente al tema.
- ESTÁS OBLIGADO A LA HONESTIDAD: si el candidato no califica para un cargo, decílo claramente. No inflés habilidades ni experiencia.
- No inventes datos del candidato ni ofertas que no existen.
- Modo asistido: el agente prepara, el usuario decide.

## Datos del candidato (si están cargados)

Si el bloque a continuación dice "no hay perfil cargado todavía", preguntá al usuario qué cargo busca y dónde está radicado. No inventes CV.

## Propuestas de mejora del perfil

Cuando el usuario te pida mejorar su perfil (ej: "ayudame a mejorar mi perfil para jefe de mantención"), tu respuesta DEBE tener esta estructura exacta:

**Paso 1 — Análisis (2-3 oraciones):** qué encontraste, qué falta, qué se puede mejorar.

**Paso 2 — Propuesta JSON (OBLIGATORIO):** después del análisis, escribí una línea que diga exactamente PROPUESTA: y luego el JSON con esta forma:

PROPUESTA:
{
  "summary": "Propuesta para mejorar tu perfil hacia [cargo]",
  "changes": [
    {
      "kind": "add_skill",
      "description": "Agregar skill: [nombre]",
      "payload": { "name": "[nombre]", "level": "[nivel]" }
    },
    {
      "kind": "update_summary",
      "description": "Reescribir resumen",
      "payload": { "summary": "[texto completo del nuevo resumen]" }
    },
    {
      "kind": "add_target_role",
      "description": "Agregar rol objetivo",
      "payload": { "roleTitle": "[cargo]", "priority": 1 }
    }
  ]
}

**Paso 3 — Pregunta de cierre:** "¿Aplicás estos cambios? Decime sí o qué ajusto."

Reglas:
- La palabra PROPUESTA: tiene que estar sola en su línea, seguida del JSON.
- El JSON tiene que ser válido y parseable.
- Máximo 5 cambios.
- Los kind válidos son: add_skill, update_summary, add_experience, add_target_role, update_location, update_profile.
- No inventes experiencia ni logros que el candidato no mencionó.`;

/**
 * Build the full LLM message array for the current conversation. Pulls
 * profile context, memory facts, and the compacted history (summaries
 * prepended to recent verbatim turns).
 */
async function buildLLMMessages(args: {
  provider: string;
  model: string | null;
  convId: string;
}): Promise<{ messages: LLMChatMessage[]; tokens: number; spec: ReturnType<typeof resolveModelContext>; }> {
  const [profileContext, facts, ctx] = await Promise.all([
    buildProfileContext(),
    listFacts(),
    buildContextForLLM(args.convId),
  ]);

  const factsBlock = formatFactsForPrompt(facts);
  const systemContent = `${PERSONA_PROMPT}\n\n${TOOLS_PROMPT}${profileContext}${factsBlock ? '\n\n' + factsBlock : ''}`;

  const messages: LLMChatMessage[] = [
    { role: 'system', content: systemContent },
    ...ctx.messages,
  ];

  const tokens = estimateMessagesTokens(messages);
  const spec = resolveModelContext(args.provider, args.model);
  return { messages, tokens, spec };
}

/**
 * Run a compaction pass: pick the oldest messages (everything beyond the
 * most recent MAX_HISTORY_TURNS turns) and ask the LLM to summarize them.
 * Persist the summary and delete the covered rows.
 */
async function maybeCompact(args: {
  provider: LLMProvider;
  providerName: string;
  model: string | null;
  convId: string;
  currentTokens: number;
  spec: ReturnType<typeof resolveModelContext>;
}): Promise<void> {
  if (args.currentTokens < args.spec.compactAt) return;

  // Get the full conversation (not just the recent window) to find what to compact.
  const profileId = (await db.select().from(candidateProfiles).limit(1))[0]?.id;
  if (!profileId) return;

  const allRows = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.profileId, profileId), eq(chatMessages.conversationId, args.convId)))
    .orderBy(asc(chatMessages.createdAt));

  if (allRows.length <= MAX_HISTORY_TURNS) return;

  const toCompact = allRows.slice(0, allRows.length - MAX_HISTORY_TURNS) as PersistedMessage[];
  if (toCompact.length === 0) return;

  const tokensBefore = estimateMessagesTokens(toLLMMessages(toCompact));

  // Ask the LLM for a concise summary. Strip <think> and trim.
  const transcript = toLLMMessages(toCompact)
    .map((m) => `${m.role === 'user' ? 'Usuario' : 'Asesor'}: ${m.content}`)
    .join('\n\n');
  const summaryPrompt = `Resumí la siguiente conversación con un candidato en no más de 400 palabras. Mantené: decisiones del candidato, datos importantes del perfil que mencionó, cargos discutidos, próximos pasos acordados. Omití saludos y cortesías. Escribí en español chileno, en tercera persona ("el candidato dijo...", "se recomendó...").\n\n${transcript}`;
  let summary: string;
  try {
    const raw = await args.provider.chat(summaryPrompt);
    summary = stripThink(raw);
    if (!summary || summary.length < 20) return; // refuse to store garbage summaries
  } catch {
    return; // compaction is best-effort; don't block the chat on a failure.
  }

  await applyCompaction({
    messagesToCompact: toCompact,
    summary,
    tokensBefore,
    model: args.model,
    conversationId: args.convId,
  });
}

const TOOL_PREFIX = 'HERRAMIENTA:';

/** Build the user-role follow-up message carrying a tool result (or parse error). */
async function toolResultMessage(parsed: ReturnType<typeof parseToolCall> & { kind: 'call' | 'error' }, approvedOrigins: ReadonlySet<string>): Promise<LLMChatMessage> {
  if (parsed.kind === 'error') {
    return { role: 'user', content: `[Error de herramienta]\n${parsed.error}` };
  }
  const result = await executeTool(parsed.call, { approvedOrigins });
  return { role: 'user', content: `[Resultado de la herramienta ${parsed.call.tool}]\n${result}` };
}

/**
 * Non-streaming tool loop: while the model's whole reply is a HERRAMIENTA:
 * call, execute it and ask again with the result appended. Returns the
 * final prose reply.
 */
async function chatWithTools(provider: LLMProvider, messages: LLMChatMessage[], approvedOrigins: ReadonlySet<string>): Promise<string> {
  let msgs = messages;
  const proseParts: string[] = [];
  for (let round = 0; ; round++) {
    const raw = await provider.chat(msgs);
    const parsed = parseToolCall(stripThink(raw));
    if (parsed.kind === 'none') {
      proseParts.push(raw);
      return proseParts.join('\n\n');
    }
    if (parsed.kind === 'call' && parsed.proseBefore !== '') proseParts.push(parsed.proseBefore);
    if (round >= MAX_TOOL_ROUNDS) {
      proseParts.push('Intenté consultar las herramientas varias veces y no logré completar la acción. Probá con una pregunta más concreta.');
      return proseParts.join('\n\n');
    }
    msgs = [...msgs, { role: 'assistant', content: raw }, await toolResultMessage(parsed, approvedOrigins)];
  }
}

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const obj = body as Record<string, unknown>;
  const message = obj.message;
  if (typeof message !== 'string' || message.trim() === '') {
    return json({ error: 'Field "message" must be a non-empty string' }, 400);
  }
  const conversationId = obj.conversationId;
  const convId = typeof conversationId === 'string' && conversationId.trim() !== '' ? conversationId.trim() : DEFAULT_CONVERSATION_ID;
  const wantStream = obj.stream === true;
  const approvedOrigins = approvedOriginsFromMessage(message.trim());

  const { provider, status } = await getActiveAgent();
  if (!status.active) {
    return json({
      error: 'No hay un proveedor de IA configurado. Andá a Configuración y elegí un proveedor.',
      code: 'PROVIDER_NOT_CONFIGURED',
      provider: status.provider,
    }, 503);
  }

  // 1. Persist user message BEFORE any LLM work so the transcript survives.
  await appendMessage({ role: 'user', content: message.trim(), conversationId: convId });

  // 2. Build context and trigger compaction if needed.
  let ctx = await buildLLMMessages({ provider: status.provider, model: provider.model ?? null, convId });
  await maybeCompact({
    provider,
    providerName: status.provider,
    model: provider.model ?? null,
    convId,
    currentTokens: ctx.tokens,
    spec: ctx.spec,
  });
  // Rebuild context after potential compaction so the displayed usage reflects
  // the post-compaction state (otherwise the user would see pre-compaction
  // numbers even after we trimmed history).
  ctx = await buildLLMMessages({ provider: status.provider, model: provider.model ?? null, convId });

  const usage = {
    tokens: ctx.tokens,
    contextWindow: ctx.spec.context,
    compactAt: ctx.spec.compactAt,
    percent: Math.round((ctx.tokens / ctx.spec.context) * 1000) / 10,
    model: provider.model ?? null,
    provider: status.provider,
  };

  // 3. STREAMING MODE: SSE so the user sees tokens appear progressively and
  //    the response survives tab switches. We persist only when the stream
  //    finishes successfully (so a cancelled stream doesn't leave a stub).
  if (wantStream) {
    if (typeof provider.chatStream !== 'function') {
      // Provider doesn't support streaming — fall back to non-streaming
      // implementation below. Frontend will see the full reply at once.
      // Fall through.
    } else {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          let assistantText = '';
          const signal = (request as Request & { signal?: AbortSignal }).signal;
          const emit = (text: string) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: text })}\n\n`));
          try {
            // Tool-call aware streaming: hold back a small window so the
            // HERRAMIENTA: marker is caught anywhere in the reply (models often
            // write "Voy a revisar…" before the call). Prose before the marker
            // streams through; the call itself is swallowed, executed, and a
            // new round starts. Only prose reaches the user.
            let msgs = ctx.messages;
            let toolRounds = 0;
            let visibleText = '';
            const HOLD = TOOL_PREFIX.length - 1;
            for (;;) {
              let pending = '';
              let roundRaw = '';
              let isToolCall = false;
              for await (const chunk of provider.chatStream!(msgs, { signal })) {
                roundRaw += chunk;
                pending += chunk;
                if (isToolCall) continue; // swallow the rest of the call
                const idx = pending.indexOf(TOOL_PREFIX);
                if (idx >= 0) {
                  isToolCall = true;
                  const prose = pending.slice(0, idx);
                  if (prose !== '') {
                    visibleText += prose;
                    emit(prose);
                  }
                  pending = pending.slice(idx);
                } else {
                  const safe = Math.max(0, pending.length - HOLD);
                  if (safe > 0) {
                    const out = pending.slice(0, safe);
                    pending = pending.slice(safe);
                    visibleText += out;
                    emit(out);
                  }
                }
              }
              if (!isToolCall) {
                if (pending !== '') {
                  visibleText += pending;
                  emit(pending);
                }
                break;
              }
              const parsed = parseToolCall(stripThink(pending));
              if (parsed.kind === 'none') {
                // The marker was prose after all — flush what we held back.
                visibleText += pending;
                emit(pending);
                break;
              }
              toolRounds++;
              if (toolRounds > MAX_TOOL_ROUNDS) {
                const exhausted = 'Intenté consultar las herramientas varias veces y no logré completar la acción. Probá con una pregunta más concreta.';
                visibleText += exhausted;
                emit(exhausted);
                break;
              }
              if (parsed.kind === 'call') {
                controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify({ tool: parsed.call.tool })}\n\n`));
              }
              msgs = [...msgs, { role: 'assistant', content: roundRaw }, await toolResultMessage(parsed, approvedOrigins)];
            }
            assistantText = visibleText;
            const final = stripThink(assistantText);

            // Detect profile-improvement proposals embedded in the reply.
            const { proposal, cleanText } = extractProposal(final);
            let finalReply = cleanText;
            let proposalId: number | null = null;
            if (proposal) {
              for (let i = 0; i < proposal.changes.length; i++) {
                const change = proposal.changes[i]!;
                const description = i === 0 ? `${proposal.summary}\n\n${change.description}` : change.description;
                try {
                  const created = await createProposal({
                    kind: change.kind as never,
                    description,
                    payload: change.payload,
                  });
                  if (i === 0) proposalId = created.id;
                } catch {
                  // If a single change fails to save, skip it but keep the rest.
                }
              }
              if (proposalId !== null) {
                finalReply = `${cleanText}\n\n---\n\nPropuesta guardada. Revisala en tu perfil y aceptala o rechazala desde ahí.`;
              }
            }

            await appendMessage({
              role: 'assistant',
              content: finalReply,
              conversationId: convId,
              provider: status.provider,
              model: provider.model ?? null,
            });
            controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ reply: finalReply, provider: status.provider, model: provider.model ?? null, usage, proposalId })}\n\n`));
            controller.close();
          } catch (err) {
            const cancelled = signal?.aborted;
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: cancelled ? 'cancelled' : 'stream_failed', cancelled: !!cancelled })}\n\n`));
            controller.close();
          }
        },
      });
      return sse(stream);
    }
  }

  // 4. NON-STREAMING MODE: single round-trip, persist reply.
  try {
    const rawReply = await chatWithTools(provider, ctx.messages, approvedOrigins);
    const reply = stripThink(rawReply);

    // Detect profile-improvement proposals embedded in the reply.
    const { proposal, cleanText } = extractProposal(reply);
    let finalReply = cleanText;
    let proposalId: number | null = null;
    if (proposal) {
      // Save each change as a separate proposal so the user can accept
      // them individually. The summary is prepended to the first change
      // description so it shows up in the UI.
      for (let i = 0; i < proposal.changes.length; i++) {
        const change = proposal.changes[i]!;
        const description = i === 0 ? `${proposal.summary}\n\n${change.description}` : change.description;
        try {
          const created = await createProposal({
            kind: change.kind as never,
            description,
            payload: change.payload,
          });
          if (i === 0) proposalId = created.id;
        } catch {
          // If a single change fails to save, skip it but keep the rest.
        }
      }
      if (proposalId !== null) {
        finalReply = `${cleanText}\n\n---\n\nPropuesta guardada. Revisala en tu perfil y aceptala o rechazala desde ahí.`;
      }
    }

    await appendMessage({
      role: 'assistant',
      content: finalReply,
      conversationId: convId,
      provider: status.provider,
      model: provider.model ?? null,
    });
    return json({ reply: finalReply, provider: status.provider, model: provider.model ?? null, usage, proposalId });
  } catch {
    return json({
      error: 'El proveedor no respondió. Revisá credenciales, modelo y conexión.',
      code: 'PROVIDER_REQUEST_FAILED',
      provider: status.provider,
    }, 503);
  }
};
