import type { PlatformSkill, ScanResult, SkillHealth, SkillContext } from '@employment-agent/skill-runtime';
import { HumanInterventionRequired } from '@employment-agent/skill-runtime';
import type { CandidateProfile } from '@employment-agent/domain';

const FAKE_JOB_COUNT = 5;

export const examplePlatformSkill: PlatformSkill = {
  slug: 'example-platform',
  version: '0.1.0',
  displayName: 'Plataforma de ejemplo (stub)',
  requiredCandidateFields: [],
  capabilities: {
    canScan: true,
    canApply: false,
    canDetectLoggedOut: false,
  },

  async scan(profile: CandidateProfile, ctx: SkillContext): Promise<ScanResult> {
    await ctx.events.emit({
      kind: 'scan_started',
      message: 'Iniciando revisión de Plataforma de ejemplo',
      payload: { profileId: profile.id ?? null },
    });

    const fakeJobs = Array.from({ length: FAKE_JOB_COUNT }, (_, i) => ({
      externalId: `stub-${Date.now()}-${i}`,
      title: `Oferta de ejemplo ${i + 1}`,
      company: 'Empresa Stub',
      location: 'Remoto',
      url: `https://example.com/jobs/${i}`,
      description: `Descripción de la oferta stub número ${i + 1}.`,
    }));

    for (const job of fakeJobs) {
      await ctx.events.emit({
        kind: 'job_found',
        message: `Encontrada: ${job.title} en ${job.company}`,
        payload: job,
      });
    }

    await ctx.events.emit({
      kind: 'scan_completed',
      message: `Escaneo completado: ${fakeJobs.length} ofertas encontradas`,
      payload: { jobsFound: fakeJobs.length },
    });

    return {
      jobsFound: fakeJobs.length,
      jobsNew: fakeJobs.length,
      jobsDuplicate: 0,
      errors: 0,
    };
  },

  async apply(): Promise<never> {
    throw new HumanInterventionRequired(
      'Stub skill does not apply — review the offer in the dashboard and submit manually.'
    );
  },

  async selfCheck(): Promise<SkillHealth> {
    return {
      status: 'healthy',
      schemaVersion: '0.1.0',
      detectedAt: new Date().toISOString(),
    };
  },
};
