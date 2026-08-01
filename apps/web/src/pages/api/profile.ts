import type { APIRoute } from 'astro';
import { db } from '@employment-agent/database';
import { candidateProfiles, candidateExperiences, candidateSkills } from '@employment-agent/database/schema';
import { eq } from 'drizzle-orm';

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
  const profile = profiles[0];
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
    await db.update(candidateProfiles).set(updateSet).where(eq(candidateProfiles.id, profiles[0].id));
  }

  const updated = await db.select().from(candidateProfiles).where(eq(candidateProfiles.id, profiles[0].id));
  return json({ status: 'ok', profile: updated[0] });
};
