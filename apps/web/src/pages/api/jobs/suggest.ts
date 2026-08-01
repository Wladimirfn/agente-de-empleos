import type { APIRoute } from 'astro';
import { getActiveAgent } from '../../../lib/agent.js';
import { db } from '@employment-agent/database';
import { candidateProfiles, candidateExperiences, candidateSkills } from '@employment-agent/database/schema';
import { eq } from 'drizzle-orm';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

function stripThink(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .trim();
}

/**
 * Extract a JSON array of strings from arbitrary LLM output. The model
 * sometimes wraps the array in prose or a code fence; we look for the
 * first `[` and the matching closing `]`.
 */
function extractJsonArray(text: string): string[] {
  const start = text.indexOf('[');
  if (start === -1) return [];
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (Array.isArray(parsed)) {
      return parsed.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
    }
  } catch {
    // fall through to return []
  }
  return [];
}

/**
 * GET /api/jobs/suggest
 *
 * Returns 5 search queries the user could try, tailored to their profile
 * (skills, experiences, location). Used by the /ofertas UI to render
 * suggestion chips above the search bar.
 */
export const GET: APIRoute = async () => {
  const { provider, status } = await getActiveAgent();
  if (!status.active) {
    return json({
      error: 'No hay un proveedor de IA configurado.',
      code: 'PROVIDER_NOT_CONFIGURED',
    }, 503);
  }

  let profile: { fullName?: string | null; location?: string | null; summary?: string | null } | null = null;
  let experiences: Array<{ role: string; company: string; description?: string | null }> = [];
  let skills: Array<{ name: string; years?: number | null }> = [];
  try {
    const profiles = await db.select().from(candidateProfiles).limit(1);
    if (profiles[0]) {
      profile = profiles[0];
      const p = profiles[0];
      experiences = await db.select().from(candidateExperiences).where(eq(candidateExperiences.profileId, p.id));
      skills = await db.select().from(candidateSkills).where(eq(candidateSkills.profileId, p.id));
    }
  } catch {
    // No profile loaded — agent returns generic suggestions below.
  }

  const profileSummary = profile
    ? `Perfil del candidato:
- Nombre: ${profile.fullName ?? 'no disponible'}
- Ubicación: ${profile.location ?? 'no disponible'}
- Resumen: ${profile.summary ?? 'no disponible'}
- Experiencias: ${experiences.map((e) => `${e.role} en ${e.company}`).join('; ') || 'sin experiencias'}
- Skills: ${skills.map((s) => `${s.name}${s.years ? ` (${s.years} años)` : ''}`).join(', ') || 'sin skills'}`
    : 'No hay perfil cargado todavía.';

  const prompt = `Sos un asistente de búsqueda de empleo. Dado el perfil del candidato, sugerí 5 consultas de búsqueda concretas que el candidato podría usar en portales de empleo para encontrar ofertas relevantes.

${profileSummary}

Reglas:
- Cada consulta debe ser un string corto (1-4 palabras), en español, listo para tipear en un buscador.
- Usá sinónimos y variaciones del rol (ej: si es técnico en refrigeración, sugerí "técnico en frío", "refrigeración industrial", "climatización").
- Incluí al menos una consulta para cada área de experiencia del candidato.
- Incluí al menos una consulta para su ubicación si la tiene.
- NO inventes cargos que el candidato no pueda aspirar (no "gerente general" si tiene 5 años de experiencia).
- Respondé SOLO con un array JSON de 5 strings, sin explicaciones. Ejemplo:
["técnico en refrigeración","jefe de mantención","mantenimiento industrial","refrigeración amoniaco","técnico Puerto Montt"]`;

  try {
    const raw = await provider.chat(prompt);
    const cleaned = stripThink(raw);
    const suggestions = extractJsonArray(cleaned).slice(0, 5);
    if (suggestions.length === 0) {
      // Fallback: derive from skills directly without the LLM.
      const fallback = skills.slice(0, 3).map((s) => s.name);
      if (profile?.location) fallback.push(profile.location);
      return json({ suggestions: fallback, source: 'fallback' });
    }
    return json({ suggestions, source: 'llm' });
  } catch {
    return json({ error: 'El proveedor no respondió.', code: 'PROVIDER_REQUEST_FAILED' }, 503);
  }
};
