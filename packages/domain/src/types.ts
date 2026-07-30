export interface Experience {
  id?: number;
  company: string;
  role: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  source?: 'form' | 'cv-parsed' | 'cv-corrected';
}

export interface Skill {
  id?: number;
  name: string;
  level?: string;
  years?: number;
}

export interface Education {
  institution: string;
  degree?: string;
  startDate?: string;
  endDate?: string;
}

export interface CandidateProfile {
  id?: number;
  fullName?: string;
  email?: string;
  phone?: string;
  location?: string;
  summary?: string;
  experiences?: Experience[];
  skills?: Skill[];
  education?: Education[];
  createdAt?: string;
  updatedAt?: string;
}

export type ApplicationStatus = 'draft' | 'ready' | 'submitted' | 'failed' | 'rejected';

export interface Job {
  id?: number;
  platformId: number;
  externalId: string;
  title: string;
  company?: string;
  location?: string;
  url?: string;
  description?: string;
  rawPayload?: unknown;
  firstSeenAt?: string;
  lastSeenAt?: string;
  hash?: string;
}

export interface Application {
  id?: number;
  jobId: number;
  profileId: number;
  status: ApplicationStatus;
  preparedAt?: string;
  submittedAt?: string;
  evidencePath?: string;
}

export interface ApplicationEvent {
  id?: number;
  applicationId?: number;
  kind: string;
  message: string;
  payload?: unknown;
  occurredAt?: string;
}

export interface AgentRun {
  id?: number;
  kind: string;
  startedAt?: string;
  finishedAt?: string;
  status: 'running' | 'completed' | 'failed';
  summary?: string;
}

export interface SkillFailure {
  id?: number;
  skillSlug: string;
  skillVersion: string;
  errorCode?: string;
  errorMessage?: string;
  screenshotPath?: string;
  pageHtmlHash?: string;
  occurredAt?: string;
  repairedAt?: string;
  repairStrategy?: string;
}
