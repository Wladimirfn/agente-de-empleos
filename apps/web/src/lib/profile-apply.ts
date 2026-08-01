import { db } from '@employment-agent/database';
import {
  candidateExperiences,
  candidateProfiles,
  candidateSkills,
  profileProposals,
} from '@employment-agent/database/schema';
import { and, eq } from 'drizzle-orm';
import type { ProfileProposal } from './profile-targets.js';
import { resolveProposal } from './profile-targets.js';

/**
 * Apply an accepted proposal to the actual candidate profile.
 *
 * Each proposal kind maps to a concrete mutation:
 *   - add_skill → insert into candidate_skills
 *   - update_summary → update candidate_profiles.summary
 *   - update_location → update candidate_profiles.location
 *   - add_experience → insert into candidate_experiences
 *   - add_target_role → insert into candidate_target_roles (via profile-targets)
 *   - update_profile → merge arbitrary fields into candidate_profiles
 *
 * After applying, the proposal is marked as accepted. If the apply step
 * fails, the proposal stays pending so the user can retry.
 */
export async function applyProposal(proposalId: number): Promise<ProfileProposal | null> {
  const profiles = await db.select().from(candidateProfiles).limit(1);
  if (profiles.length === 0) throw new Error('No hay perfil cargado todavía.');
  const profileId = profiles[0].id;

  const rows = await db
    .select()
    .from(profileProposals)
    .where(and(eq(profileProposals.id, proposalId), eq(profileProposals.profileId, profileId)))
    .limit(1);
  if (rows.length === 0) return null;
  const proposal = rows[0];
  if (proposal.status !== 'pending') return null;

  const payload = JSON.parse(proposal.payloadJson) as Record<string, unknown>;

  try {
    switch (proposal.kind) {
      case 'add_skill': {
        const name = payload.name as string;
        if (!name) throw new Error('Missing skill name');
        await db.insert(candidateSkills).values({
          profileId,
          name,
          level: (payload.level as string) ?? null,
          years: typeof payload.years === 'number' ? payload.years : null,
        });
        break;
      }
      case 'update_summary': {
        const summary = payload.summary as string;
        if (typeof summary !== 'string') throw new Error('Missing summary');
        await db
          .update(candidateProfiles)
          .set({ summary, updatedAt: new Date().toISOString() })
          .where(eq(candidateProfiles.id, profileId));
        break;
      }
      case 'update_location': {
        const location = payload.location as string;
        if (typeof location !== 'string') throw new Error('Missing location');
        await db
          .update(candidateProfiles)
          .set({ location, updatedAt: new Date().toISOString() })
          .where(eq(candidateProfiles.id, profileId));
        break;
      }
      case 'add_experience': {
        const role = payload.role as string;
        const company = payload.company as string;
        if (!role || !company) throw new Error('Missing role or company');
        await db.insert(candidateExperiences).values({
          profileId,
          role,
          company,
          startDate: (payload.startDate as string) ?? null,
          endDate: (payload.endDate as string) ?? null,
          description: (payload.description as string) ?? null,
          source: 'cv-corrected',
        });
        break;
      }
      case 'update_profile': {
        const allowed = ['fullName', 'email', 'phone', 'location', 'summary'];
        const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
        for (const key of allowed) {
          if (payload[key] !== undefined) updates[key] = payload[key];
        }
        await db
          .update(candidateProfiles)
          .set(updates)
          .where(eq(candidateProfiles.id, profileId));
        break;
      }
      case 'add_target_role': {
        // Target roles have their own table; handled via the dedicated module.
        const { addTargetRole } = await import('./profile-targets.js');
        const roleTitle = payload.roleTitle as string;
        if (!roleTitle) throw new Error('Missing roleTitle');
        await addTargetRole({
          roleTitle,
          priority: typeof payload.priority === 'number' ? payload.priority : 1,
          isActive: payload.isActive !== false,
        });
        break;
      }
      default:
        throw new Error(`Unknown proposal kind: ${proposal.kind}`);
    }
  } catch (err) {
    // Rollback-friendly: if the apply fails, leave the proposal pending.
    throw err;
  }

  return resolveProposal({ id: proposalId, action: 'accepted' });
}
