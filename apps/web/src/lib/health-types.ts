/**
 * Tipos compartidos entre el endpoint /api/health y la island HealthDashboard.
 * Mantener este archivo sincronizado con la query de health.ts.
 */

export type SkillStatus =
  | 'healthy'
  | 'degraded'
  | 'broken'
  | 'needs-human'
  | 'unknown';

export interface SkillHealthSummary {
  skillSlug: string;
  platformSlug: string | null;
  platformDisplayName: string | null;
  platformStatus: 'active' | 'paused' | 'broken' | null;
  latestStatus: SkillStatus;
  latestCheckedAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  failuresLast24h: number;
  unrepairedFailures: number;
  /** Indica si el worker aún no corrió (sin healthchecks ni runs). */
  hasData: boolean;
}

export interface HealthResponse {
  skills: SkillHealthSummary[];
  generatedAt: string;
}