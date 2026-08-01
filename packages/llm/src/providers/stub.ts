import type { LLMProvider, StructuredResume, MatchScore } from '../types.js';
import type { CandidateProfile, Job } from '@employment-agent/domain';

/**
 * Deterministic stub provider. Returns empty/zero values.
 * Useful for local development and CI before a real LLM is wired up.
 */
export class DeterministicStubProvider implements LLMProvider {
  readonly name = 'stub';

  async parseResume(_text: string): Promise<StructuredResume> {
    return {
      experiences: [],
      education: [],
      skills: [],
    };
  }

  async scoreMatch(_profile: CandidateProfile, _job: Job): Promise<MatchScore> {
    return {
      score: 0,
      breakdown: {
        skillsMatch: 0,
        experienceMatch: 0,
        locationMatch: 0,
        seniorityMatch: 0,
      },
    };
  }

  async summarize(_text: string): Promise<string> {
    return 'stub';
  }

  async chat(_message: string | unknown[]): Promise<string> {
    return 'stub';
  }
}
