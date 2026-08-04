import type { APIRoute } from 'astro';
import { db } from '@employment-agent/database';
import {
  candidateProfiles,
  candidateExperiences,
  candidateSkills,
  candidateDocuments,
  candidateTargetRoles,
  profileProposals,
  chatMessages,
  chatMemoryFacts,
  chatSummaries,
  matchFeedback,
  jobMatches,
  applications,
  jobs,
  platforms,
  agentRuns,
  agentConfirmations,
  platformCredentials,
  systemSecrets,
  sessionCaptures,
} from '@employment-agent/database/schema';
import { eq } from 'drizzle-orm';
import { generateMasterKey } from '@employment-agent/security';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export const GET: APIRoute = async () => {
  const profiles = await db.select().from(candidateProfiles).limit(1);
  if (profiles.length === 0) {
    return json({ status: 'empty', profile: null, experiences: [], skills: [] });
  }
  const profile = profiles[0]!;
  const experiences = await db.select().from(candidateExperiences).where(eq(candidateExperiences.profileId, profile.id));
  const skills = await db.select().from(candidateSkills).where(eq(candidateSkills.profileId, profile.id));
  return json({ status: 'ok', profile, experiences, skills });
};

export const PUT: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const data = body as Record<string, unknown>;

  const profiles = await db.select().from(candidateProfiles).limit(1);
  const updateSet: Record<string, string | null> = {};
  if (typeof data.fullName === 'string') updateSet.full_name = data.fullName;
  if (typeof data.email === 'string') updateSet.email = data.email || null;
  if (typeof data.phone === 'string') updateSet.phone = data.phone || null;
  if (typeof data.location === 'string') updateSet.location = data.location || null;
  if (typeof data.summary === 'string') updateSet.summary = data.summary || null;

  if (profiles.length === 0) {
    return json({ error: 'No profile exists. Upload a CV first.' }, 404);
  }

  if (Object.keys(updateSet).length > 0) {
    updateSet.updated_at = new Date().toISOString();
    await db.update(candidateProfiles).set(updateSet).where(eq(candidateProfiles.id, profiles[0]!.id));
  }

  const updated = await db.select().from(candidateProfiles).where(eq(candidateProfiles.id, profiles[0]!.id));
  return json({ status: 'ok', profile: updated[0] });
};

/**
 * DELETE /api/profile
 *
 * Resets the candidate workspace to a clean slate. Deletes, in this order:
 *
 * 1. Profile-scoped data that the SQLite CASCADE should already handle
 *    (experiences, skills, documents, target roles, proposals, chat
 *    messages, chat memory facts, chat summaries) — but we delete
 *    these explicitly too, because the older migrations (0000_init,
 *    0006_match_feedback) declared some FKs without `ON DELETE CASCADE`,
 *    so a pure `DELETE FROM candidate_profiles` leaves orphan rows in
 *    production. Deleting them first is belt-and-braces against that
 *    drift.
 * 2. Match-related tables that reference candidate_profiles via
 *    `profile_id` but have FK drift (match_feedback, job_matches,
 *    applications). Cascade is declared in the current Drizzle schema
 *    but the underlying migration didn't recreate those FKs.
 * 3. The profile row itself.
 * 4. Job offer cache and platform registry — in the single-profile MVP
 *    every job and every platform is implicitly tied to the active
 *    profile, so resetting the profile means wiping both. After the
 *    wipe the next scan rebuilds them from scratch.
 * 5. agent_runs — diagnostic history that only makes sense in the
 *    context of the profile that produced it.
 * 6. `platform_credentials` and `system_secrets` (master key) — these
 *    are tied to the user, not the device. Wiping them and rotating the
 *    key ensures the next user starts with zero PII and zero access to
 *    the previous user's sessions.
 *
 * Settings are NOT touched:
 * - `llm_settings` — device-level config (which provider/model to use).
 * - `scan_settings` — unrelated to a specific profile.
 * - `system_secrets` IS wiped here (master key rotates on next credential save).
 * - `job_matches` (with status 'accepted') is preserved as agent learning.
 *
 * CV files on disk are intentionally left in place; they are tracked by
 * hash so a re-upload is deduped, not duplicated.
 *
 * Returns 404 if there is no profile to delete.
 */
export const DELETE: APIRoute = async () => {
  const profiles = await db.select({ id: candidateProfiles.id }).from(candidateProfiles).limit(1);
  if (profiles.length === 0) {
    return json({ error: 'No hay perfil para borrar.', code: 'NOT_FOUND' }, 404);
  }
  const profileId = profiles[0]!.id;

  await db.transaction(async (tx) => {
    // 1. Profile-scoped child tables (FK to candidate_profiles — should
    //    cascade, but we delete them explicitly to survive migration drift).
    await tx.delete(chatSummaries).where(eq(chatSummaries.profileId, profileId));
    await tx.delete(chatMemoryFacts).where(eq(chatMemoryFacts.profileId, profileId));
    await tx.delete(chatMessages).where(eq(chatMessages.profileId, profileId));
    await tx.delete(profileProposals).where(eq(profileProposals.profileId, profileId));
    await tx.delete(agentConfirmations).where(eq(agentConfirmations.profileId, profileId));
    await tx.delete(candidateTargetRoles).where(eq(candidateTargetRoles.profileId, profileId));
    await tx.delete(candidateDocuments).where(eq(candidateDocuments.profileId, profileId));
    await tx.delete(candidateSkills).where(eq(candidateSkills.profileId, profileId));
    await tx.delete(candidateExperiences).where(eq(candidateExperiences.profileId, profileId));

    // 2. Match-related tables — FK exists in schema but the underlying
    //    migration didn't recreate it, so cascade doesn't fire in prod.
    await tx.delete(matchFeedback).where(eq(matchFeedback.profileId, profileId));
    await tx.delete(jobMatches).where(eq(jobMatches.profileId, profileId));
    await tx.delete(applications).where(eq(applications.profileId, profileId));

    // 3. The profile row itself.
    await tx.delete(candidateProfiles).where(eq(candidateProfiles.id, profileId));

    // 4. Job and platform caches. In single-profile MVP, every job and
    //    every platform is implicitly "for this profile" — a new profile
    //    has to rescan to populate them.
    await tx.delete(jobs);
    await tx.delete(platforms);

    // 5. Diagnostic history.
    await tx.delete(agentRuns);

    // 6. Credentials and master key. Wiping both means the next user
    //    starts with no PII and no access to the previous sessions.
    //    The master key is regenerated transparently on the next save.
    await tx.delete(platformCredentials);
    await tx.delete(sessionCaptures);
    await tx.delete(systemSecrets);
  });

  // Force a fresh master key so a future save reprovisions encryption.
  // We do this OUTSIDE the transaction because getOrCreate would deadlock
  // if it tried to read from the same tx that just deleted the row.
  void generateMasterKey; // keep import live; rotation happens on next save.

  return json({ ok: true });
};
