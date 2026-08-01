import type { CandidateProfile, Job } from '@employment-agent/domain';

/**
 * A single message in a multi-turn chat conversation.
 * Used to pass conversation history to the LLM so it has context
 * across turns (and across server restarts).
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StructuredExperience {
  company: string;
  role: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

export interface StructuredEducation {
  institution: string;
  degree?: string;
  startDate?: string;
  endDate?: string;
}

export interface StructuredSkill {
  name: string;
  level?: string;
  years?: number;
}

export interface StructuredResume {
  fullName?: string;
  email?: string;
  phone?: string;
  location?: string;
  summary?: string;
  experiences: StructuredExperience[];
  education: StructuredEducation[];
  skills: StructuredSkill[];
}

export interface MatchBreakdown {
  skillsMatch: number;
  experienceMatch: number;
  locationMatch: number;
  seniorityMatch: number;
}

export interface MatchScore {
  score: number;
  breakdown: MatchBreakdown;
  reasoning?: string;
}

export interface LLMProvider {
  readonly name: string;
  readonly model?: string;
  parseResume(text: string): Promise<StructuredResume>;
  scoreMatch(profile: CandidateProfile, job: Job): Promise<MatchScore>;
  summarize(text: string): Promise<string>;
  /**
   * Send a chat request. Accepts either a single user message (string) or
   * a full multi-turn conversation (array of ChatMessage). When an array is
   * passed, system messages in the array take precedence over the prompt set
   * via setSystemPrompt.
   */
  chat(message: string | ChatMessage[]): Promise<string>;
  /**
   * Optional streaming variant. Yields incremental text chunks as the LLM
   * generates them. Implementations should respect `signal` so the caller
   * can cancel mid-stream (e.g. when the browser navigates away).
   */
  chatStream?(
    message: string | ChatMessage[],
    options?: { signal?: AbortSignal },
  ): AsyncIterable<string>;
  setSystemPrompt?(prompt: string): void;
}
