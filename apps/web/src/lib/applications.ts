import { db } from '@employment-agent/database';
import { applications, applicationEvents, candidateProfiles, jobs, platforms } from '@employment-agent/database/schema';
import { and, desc, eq } from 'drizzle-orm';

export interface ApplicationWithJob {
  id: number;
  jobId: number;
  status: 'draft' | 'ready' | 'submitted' | 'failed' | 'rejected';
  preparedAt: string | null;
  submittedAt: string | null;
  evidencePath: string | null;
  createdAt: string;
  job: {
    id: number;
    externalId: string;
    title: string;
    company: string | null;
    location: string | null;
    url: string | null;
    platformSlug: string;
  };
  events: Array<{
    id: number;
    kind: string;
    message: string;
    occurredAt: string;
  }>;
}

/**
 * List every application for the active profile, joined with the job
 * details and the event trail. Ordered newest first so the most recent
 * activity lands on top.
 */
export async function listApplications(): Promise<ApplicationWithJob[]> {
  const profile = await db.select().from(candidateProfiles).limit(1);
  if (profile.length === 0) return [];
  const profileId = profile[0].id;

  const rows = await db
    .select({
      id: applications.id,
      jobId: applications.jobId,
      status: applications.status,
      preparedAt: applications.preparedAt,
      submittedAt: applications.submittedAt,
      evidencePath: applications.evidencePath,
      createdAt: applications.createdAt,
      jobId2: jobs.id,
      externalId: jobs.externalId,
      title: jobs.title,
      company: jobs.company,
      location: jobs.location,
      url: jobs.url,
      platformSlug: platforms.slug,
    })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .innerJoin(platforms, eq(jobs.platformId, platforms.id))
    .where(eq(applications.profileId, profileId))
    .orderBy(desc(applications.createdAt));

  const eventRows = await db
    .select()
    .from(applicationEvents)
    .orderBy(desc(applicationEvents.occurredAt));

  const eventsByAppId = new Map<number, typeof eventRows>();
  for (const ev of eventRows) {
    if (ev.applicationId == null) continue;
    if (!eventsByAppId.has(ev.applicationId)) eventsByAppId.set(ev.applicationId, []);
    eventsByAppId.get(ev.applicationId)!.push(ev);
  }

  return rows.map((r) => ({
    id: r.id,
    jobId: r.jobId,
    status: r.status,
    preparedAt: r.preparedAt,
    submittedAt: r.submittedAt,
    evidencePath: r.evidencePath,
    createdAt: r.createdAt,
    job: {
      id: r.jobId2,
      externalId: r.externalId,
      title: r.title,
      company: r.company,
      location: r.location,
      url: r.url,
      platformSlug: r.platformSlug,
    },
    events: (eventsByAppId.get(r.id) ?? []).map((e) => ({
      id: e.id,
      kind: e.kind,
      message: e.message,
      occurredAt: e.occurredAt,
    })),
  }));
}

/**
 * Transition an application to a new status. Only valid forward moves
 * are allowed (draft → ready → submitted, or draft → rejected/failed).
 */
export async function updateApplicationStatus(args: {
  applicationId: number;
  status: ApplicationWithJob['status'];
}): Promise<ApplicationWithJob | null> {
  const profile = await db.select().from(candidateProfiles).limit(1);
  if (profile.length === 0) throw new Error('No hay perfil cargado todavía.');

  const existing = await db
    .select()
    .from(applications)
    .where(and(eq(applications.id, args.applicationId), eq(applications.profileId, profile[0].id)))
    .limit(1);
  if (existing.length === 0) return null;

  const now = new Date().toISOString();
  const updates: Partial<typeof applications.$inferInsert> = { status: args.status };
  if (args.status === 'submitted') updates.submittedAt = now;
  await db
    .update(applications)
    .set(updates)
    .where(eq(applications.id, args.applicationId));

  // Log the transition as an event for the audit trail.
  await db.insert(applicationEvents).values({
    applicationId: args.applicationId,
    kind: 'status_change',
    message: `Estado cambiado a ${args.status}`,
    payloadJson: JSON.stringify({ from: existing[0].status, to: args.status }),
  });

  const updated = await db.select().from(applications).where(eq(applications.id, args.applicationId)).limit(1);
  if (updated.length === 0) return null;
  // Re-join with job + events for the response.
  const all = await listApplications();
  return all.find((a) => a.id === args.applicationId) ?? null;
}
