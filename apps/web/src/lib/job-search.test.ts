import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tempRoot = mkdtempSync(join(tmpdir(), `ea-jobs-${randomUUID()}-`));
process.env.DATABASE_PATH = join(tempRoot, 'jobs.db');
process.env.STORAGE_PATH = join(tempRoot, 'storage');

describe.sequential ??= () => {};

const { db, runMigrations, closeDb } = await import('@employment-agent/database');
const { candidateProfiles, candidateExperiences, candidateSkills, jobs, jobMatches, applications, platforms } = await import('@employment-agent/database/schema');
const { applyToJob, listMatches, searchJobs } = await import('./job-search.js');

let profileId: number;

beforeEach(async () => {
  await runMigrations();
  await db.delete(applications);
  await db.delete(jobMatches);
  await db.delete(jobs);
  await db.delete(candidateExperiences);
  await db.delete(candidateSkills);
  await db.delete(candidateProfiles);
  await db.delete(platforms);
  const inserted = await db.insert(candidateProfiles).values({
    fullName: 'Eric Flores',
    email: 'e@x.com',
    location: 'Puerto Montt',
    summary: 'Técnico en refrigeración industrial con 11 años de experiencia.',
  }).returning({ id: candidateProfiles.id });
  profileId = inserted[0].id;
  await db.insert(candidateExperiences).values({
    profileId,
    company: 'Integra Chile',
    role: 'Planificador de mantenimiento',
    startDate: '2022-01',
    description: 'Planificación de mantenimiento industrial',
    source: 'form',
  });
  await db.insert(candidateSkills).values([
    { profileId, name: 'Refrigeración industrial', years: 11 },
    { profileId, name: 'Amoniaco', years: 6 },
    { profileId, name: 'Mantenimiento preventivo', years: 11 },
  ]);
});

afterAll(async () => {
  await closeDb();
});

const stubProvider = {
  name: 'stub',
  scoreMatch: vi.fn(async (_profile: unknown, job: { title: string }) => {
    // Deterministic scoring based on title keywords so we can test ordering.
    const title = job.title.toLowerCase();
    let score = 30;
    if (title.includes('mantención') || title.includes('mantenimiento')) score = 80;
    if (title.includes('refrigeración')) score = 95;
    return {
      score,
      breakdown: { skillsMatch: score, experienceMatch: score, locationMatch: score, seniorityMatch: score },
      reasoning: 'match determinístico de test',
    };
  }),
};

beforeEach(() => {
  stubProvider.scoreMatch.mockClear();
});

describe('job-search orchestrator', () => {
  it('persists new jobs, scores them, and returns matches ordered by score', async () => {
    const mockSource = {
      name: 'mock',
      async searchJobs() {
        return [
          { externalId: 'j1', platformSlug: 'mock', title: 'Marketing Manager', company: 'X', rawPayload: {} },
          { externalId: 'j2', platformSlug: 'mock', title: 'Técnico en refrigeración industrial', company: 'Y', rawPayload: {} },
          { externalId: 'j3', platformSlug: 'mock', title: 'Jefe de mantención', company: 'Z', rawPayload: {} },
        ];
      },
    };
    const results = await searchJobs({ query: 'mantención', limit: 10, sources: [mockSource] }, stubProvider as never);
    expect(results.length).toBe(3);
    // Refrigeración scores highest, then jefe de mantención, then marketing.
    expect(results[0].title).toContain('refrigeración');
    expect(results[0].score).toBe(95);
    expect(results[1].title).toContain('mantención');
    expect(results[1].score).toBe(80);
    expect(results[2].title).toContain('Marketing');
    expect(results[2].score).toBe(30);
    expect(stubProvider.scoreMatch).toHaveBeenCalledTimes(3);
  });

  it('reuses cached matches on a second search instead of re-paying the LLM', async () => {
    const mockSource = {
      name: 'mock',
      async searchJobs() {
        return [{ externalId: 'j1', platformSlug: 'mock', title: 'Técnico en refrigeración', rawPayload: {} }];
      },
    };
    const first = await searchJobs({ query: 'refrigeración', sources: [mockSource] }, stubProvider as never);
    expect(first.length).toBe(1);
    expect(stubProvider.scoreMatch).toHaveBeenCalledTimes(1);

    const second = await searchJobs({ query: 'refrigeración', sources: [mockSource] }, stubProvider as never);
    expect(second.length).toBe(1);
    // Second call should hit the cache, not the LLM.
    expect(stubProvider.scoreMatch).toHaveBeenCalledTimes(1);
    expect(second[0].id).toBe(first[0].id);
  });

  it('dedupes the same external id from the same platform', async () => {
    const source = {
      name: 'mock',
      async searchJobs() {
        return [
          { externalId: 'dup', platformSlug: 'mock', title: 'Técnico X', rawPayload: {} },
          { externalId: 'dup', platformSlug: 'mock', title: 'Técnico X', rawPayload: {} },
        ];
      },
    };
    const results = await searchJobs({ query: 'técnico', sources: [source] }, stubProvider as never);
    expect(results.length).toBe(1);
  });

  it('applyToJob marks a job as applied and is idempotent', async () => {
    const mockSource = {
      name: 'mock',
      async searchJobs() {
        return [{ externalId: 'j1', platformSlug: 'mock', title: 'Jefe de mantención', rawPayload: {} }];
      },
    };
    const results = await searchJobs({ query: 'jefe', sources: [mockSource] }, stubProvider as never);
    const jobId = results[0].id;

    const first = await applyToJob({ jobId, llm: stubProvider as never });
    const second = await applyToJob({ jobId, llm: stubProvider as never });
    expect(second.applicationId).toBe(first.applicationId);

    const matches = await listMatches();
    expect(matches[0].applied).toBe(true);
  });

  it('applyToJob throws when the job does not exist', async () => {
    await expect(applyToJob({ jobId: 999, llm: stubProvider as never })).rejects.toThrow(/no encontrada/);
  });

  it('applyToJob throws when no profile is loaded', async () => {
    await db.delete(candidateProfiles);
    const mockSource = {
      name: 'mock',
      async searchJobs() {
        return [{ externalId: 'j1', platformSlug: 'mock', title: 'X', rawPayload: {} }];
      },
    };
    // searchJobs will also throw because there's no profile, but let's call
    // applyToJob directly with a job id we know doesn't exist.
    await expect(applyToJob({ jobId: 1, llm: stubProvider as never })).rejects.toThrow(/perfil/);
  });
});
