import type { CandidateProfile, Job, Application } from '@employment-agent/domain';

export type SkillStatus = 'healthy' | 'degraded' | 'broken' | 'needs-human';

export interface ScanResult {
  jobsFound: number;
  jobsNew: number;
  jobsDuplicate: number;
  errors: number;
  rawEvidencePath?: string;
}

export interface SkillHealth {
  status: SkillStatus;
  lastError?: {
    code: string;
    message: string;
    screenshotPath?: string;
  };
  schemaVersion: string;
  detectedAt: string;
}

export interface SkillCapabilities {
  canScan: boolean;
  canApply: boolean;
  canDetectLoggedOut: boolean;
}

export interface ApplicationResult {
  status: 'draft' | 'ready' | 'submitted' | 'failed';
  applicationId?: number;
  evidencePath?: string;
  message?: string;
}

export interface EventPayload {
  kind: string;
  message: string;
  payload?: unknown;
}

export interface EventEmitter {
  emit(event: EventPayload): Promise<void>;
}

export interface BrowserPool {
  acquire(): Promise<unknown>;
  release(handle: unknown): Promise<void>;
}

export interface SkillContext {
  events: EventEmitter;
  browserPool?: BrowserPool;
  profile?: CandidateProfile;
}

export interface PlatformSkill {
  readonly slug: string;
  readonly version: string;
  readonly displayName: string;
  readonly requiredCandidateFields: ReadonlyArray<keyof CandidateProfile>;
  readonly capabilities: SkillCapabilities;
  scan(profile: CandidateProfile, ctx: SkillContext): Promise<ScanResult>;
  apply?(job: Job, profile: CandidateProfile, ctx: SkillContext): Promise<ApplicationResult>;
  selfCheck(): Promise<SkillHealth>;
}
