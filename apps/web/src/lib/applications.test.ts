import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tempRoot = mkdtempSync(join(tmpdir(), `ea-apps-${randomUUID()}-`));
process.env.DATABASE_PATH = join(tempRoot, 'apps.db');
process.env.STORAGE_PATH = join(tempRoot, 'storage');

describe.sequential ??= () => {};

const { db, runMigrations, closeDb } = await import('@employment-agent/database');
const { applications, applicationEvents, candidateProfiles, jobs, platforms } = await import('@employment-agent/database/schema');
const { listApplications, updateApplicationStatus } = await import('./applications.js');

let profileId: number;
let platformId: number;

beforeEach(async () => {
  await runMigrations();
  await db.delete(applicationEvents);
  await db.delete(applications);
  await db.delete(jobs);
  await db.delete(candidateProfiles);
  await db.delete(platforms);
  const insertedProfile = await db.insert(candidateProfiles).values({
    fullName: 'Eric Flores',
    email: 'e@x.com',
    location: 'Puerto Montt',
  }).returning({ id: candidateProfiles.id });
  profileId = insertedProfile[0].id;
  const insertedPlatform = await db.insert(platforms).values({
    slug: 'getonboard',
    displayName: 'GetOnboard',
    baseUrl: 'https://www.getonbrd.com',
    status: 'active',
  }).returning({ id: platforms.id });
  platformId = insertedPlatform[0].id;
});

afterAll(async () => {
  await closeDb();
});

async function insertJob(title: string, externalId: string): Promise<number> {
  const inserted = await db.insert(jobs).values({
    platformId,
    externalId,
    title,
    company: 'TestCo',
    location: 'Puerto Montt',
    url: 'https://example.com/job/' + externalId,
  }).returning({ id: jobs.id });
  return inserted[0].id;
}

describe('applications', () => {
  it('returns empty list when no applications exist', async () => {
    const result = await listApplications();
    expect(result).toEqual([]);
  });

  it('lists applications with job details and events', async () => {
    const jobId = await insertJob('Jefe de Mantención', 'j1');
    await db.insert(applications).values({
      jobId,
      profileId,
      status: 'submitted',
      preparedAt: '2026-07-30T10:00:00Z',
      submittedAt: '2026-07-31T10:00:00Z',
    });
    await db.insert(applicationEvents).values({
      applicationId: 1,
      kind: 'status_change',
      message: 'Estado cambiado a submitted',
    });

    const result = await listApplications();
    expect(result.length).toBe(1);
    expect(result[0].job.title).toBe('Jefe de Mantención');
    expect(result[0].job.platformSlug).toBe('getonboard');
    expect(result[0].status).toBe('submitted');
    expect(result[0].events.length).toBe(1);
    expect(result[0].events[0].message).toContain('submitted');
  });

  it('orders newest first', async () => {
    const jobId = await insertJob('A', 'a');
    await db.insert(applications).values({ jobId, profileId, status: 'draft', createdAt: '2026-07-30T10:00:00Z' });
    await db.insert(applications).values({ jobId, profileId, status: 'ready', createdAt: '2026-07-31T10:00:00Z' });

    const result = await listApplications();
    expect(result[0].status).toBe('ready');
    expect(result[1].status).toBe('draft');
  });

  it('updateApplicationStatus transitions and logs the change', async () => {
    const jobId = await insertJob('Técnico', 't1');
    const inserted = await db.insert(applications).values({
      jobId,
      profileId,
      status: 'draft',
    }).returning({ id: applications.id });
    const appId = inserted[0].id;

    const updated = await updateApplicationStatus({ applicationId: appId, status: 'ready' });
    expect(updated?.status).toBe('ready');

    const events = await db.select().from(applicationEvents);
    expect(events.length).toBe(1);
    expect(events[0].kind).toBe('status_change');
    expect(events[0].message).toContain('ready');
  });

  it('updateApplicationStatus returns null for unknown id', async () => {
    const result = await updateApplicationStatus({ applicationId: 999, status: 'ready' });
    expect(result).toBeNull();
  });

  it('updateApplicationStatus sets submittedAt when status becomes submitted', async () => {
    const jobId = await insertJob('Supervisor', 's1');
    const inserted = await db.insert(applications).values({
      jobId,
      profileId,
      status: 'ready',
    }).returning({ id: applications.id });
    const appId = inserted[0].id;

    const updated = await updateApplicationStatus({ applicationId: appId, status: 'submitted' });
    expect(updated?.status).toBe('submitted');
    expect(updated?.submittedAt).not.toBeNull();
  });
});
