import type { LLMProvider, MatchScore, StructuredResume, ChatMessage } from './types.js';
import type { CandidateProfile, Job } from '@employment-agent/domain';

const EMPTY_RESUME: StructuredResume = { experiences: [], education: [], skills: [] };
const ZERO_SCORE: MatchScore = {
  score: 0,
  breakdown: { skillsMatch: 0, experienceMatch: 0, locationMatch: 0, seniorityMatch: 0 },
};

function extractJson(raw: string): string {
  const match = raw.match(/\{[\s\S]*\}/);
  return match ? match[0] : raw;
}

/**
 * Base for pilot providers: only `chat` is provider-specific; the structured
 * helpers are derived from it with a conservative fallback on parse failure.
 */
export abstract class ChatBackedProvider implements LLMProvider {
  abstract readonly name: string;
  abstract readonly model?: string;
  abstract chat(message: string | ChatMessage[]): Promise<string>;

  async parseResume(text: string): Promise<StructuredResume> {
    const raw = await this.chat(
      `Extrae el CV a JSON con claves fullName, email, phone, location, summary, experiences, education, skills. Responde solo JSON.\n\n${text}`,
    );
    try {
      return { ...EMPTY_RESUME, ...JSON.parse(extractJson(raw)) };
    } catch {
      return { ...EMPTY_RESUME };
    }
  }

  async scoreMatch(profile: CandidateProfile, job: Job): Promise<MatchScore> {
    const raw = await this.chat(
      `Puntua el match (0-100) entre perfil y oferta. Responde solo JSON con claves score, breakdown{skillsMatch,experienceMatch,locationMatch,seniorityMatch}, reasoning.\nPerfil: ${JSON.stringify(profile)}\nOferta: ${JSON.stringify(job)}`,
    );
    try {
      const parsed = JSON.parse(extractJson(raw));
      return { ...ZERO_SCORE, ...parsed, breakdown: { ...ZERO_SCORE.breakdown, ...(parsed.breakdown ?? {}) } };
    } catch {
      return { ...ZERO_SCORE, breakdown: { ...ZERO_SCORE.breakdown } };
    }
  }

  async summarize(text: string): Promise<string> {
    return this.chat(`Resume en 3 oraciones:\n\n${text}`);
  }
}
