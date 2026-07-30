import type { CandidateProfile, Job } from '@employment-agent/domain';

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
  parseResume(text: string): Promise<StructuredResume>;
  scoreMatch(profile: CandidateProfile, job: Job): Promise<MatchScore>;
  summarize(text: string): Promise<string>;
}
