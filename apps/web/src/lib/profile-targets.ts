import { db } from '@employment-agent/database';
import {
  candidateProfiles,
  candidateTargetRoles,
  profileProposals,
} from '@employment-agent/database/schema';
import { and, asc, desc, eq } from 'drizzle-orm';

export interface TargetRole {
  id: number;
  roleTitle: string;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileProposal {
  id: number;
  kind: 'add_skill' | 'update_summary' | 'add_experience' | 'add_target_role' | 'update_location' | 'update_profile';
  description: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
  resolvedAt: string | null;
}

async function resolveProfileId(): Promise<number> {
  const rows = await db.select().from(candidateProfiles).limit(1);
  return rows[0]?.id ?? 0;
}

// ----- Target Roles -----

export async function listTargetRoles(): Promise<TargetRole[]> {
  const profileId = await resolveProfileId();
  if (profileId === 0) return [];
  const rows = await db
    .select()
    .from(candidateTargetRoles)
    .where(eq(candidateTargetRoles.profileId, profileId))
    .orderBy(asc(candidateTargetRoles.priority), desc(candidateTargetRoles.isActive));
  return rows.map((r) => ({
    id: r.id,
    roleTitle: r.roleTitle,
    priority: r.priority,
    isActive: r.isActive === 1,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function addTargetRole(args: {
  roleTitle: string;
  priority?: number;
  isActive?: boolean;
}): Promise<TargetRole> {
  const profileId = await resolveProfileId();
  if (profileId === 0) throw new Error('No hay perfil cargado todavía.');

  // Case-insensitive dedupe: if a role with the same title already exists,
  // return it instead of creating a duplicate.
  const existing = await db
    .select()
    .from(candidateTargetRoles)
    .where(eq(candidateTargetRoles.profileId, profileId));
  const normalized = args.roleTitle.trim().toLowerCase();
  const dup = existing.find((r) => r.roleTitle.trim().toLowerCase() === normalized);
  if (dup) {
    return {
      id: dup.id,
      roleTitle: dup.roleTitle,
      priority: dup.priority,
      isActive: dup.isActive === 1,
      createdAt: dup.createdAt,
      updatedAt: dup.updatedAt,
    };
  }

  const rows = await db
    .insert(candidateTargetRoles)
    .values({
      profileId,
      roleTitle: args.roleTitle.trim(),
      priority: args.priority ?? 1,
      isActive: args.isActive === false ? 0 : 1,
    })
    .returning();
  const r = rows[0];
  return {
    id: r.id,
    roleTitle: r.roleTitle,
    priority: r.priority,
    isActive: r.isActive === 1,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function updateTargetRole(args: {
  id: number;
  roleTitle?: string;
  priority?: number;
  isActive?: boolean;
}): Promise<TargetRole | null> {
  const profileId = await resolveProfileId();
  if (profileId === 0) return null;
  const existing = await db
    .select()
    .from(candidateTargetRoles)
    .where(and(eq(candidateTargetRoles.id, args.id), eq(candidateTargetRoles.profileId, profileId)))
    .limit(1);
  if (existing.length === 0) return null;
  const updates: Partial<typeof candidateTargetRoles.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (args.roleTitle !== undefined) updates.roleTitle = args.roleTitle;
  if (args.priority !== undefined) updates.priority = args.priority;
  if (args.isActive !== undefined) updates.isActive = args.isActive ? 1 : 0;
  await db
    .update(candidateTargetRoles)
    .set(updates)
    .where(eq(candidateTargetRoles.id, args.id));
  const updated = await db.select().from(candidateTargetRoles).where(eq(candidateTargetRoles.id, args.id)).limit(1);
  const r = updated[0];
  return {
    id: r.id,
    roleTitle: r.roleTitle,
    priority: r.priority,
    isActive: r.isActive === 1,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function deleteTargetRole(id: number): Promise<boolean> {
  const profileId = await resolveProfileId();
  if (profileId === 0) return false;
  const rows = await db
    .delete(candidateTargetRoles)
    .where(and(eq(candidateTargetRoles.id, id), eq(candidateTargetRoles.profileId, profileId)))
    .returning();
  return rows.length > 0;
}

export async function getActiveTargetRoles(): Promise<TargetRole[]> {
  const roles = await listTargetRoles();
  return roles.filter((r) => r.isActive).sort((a, b) => a.priority - b.priority);
}

// ----- Profile Proposals -----

export async function listProposals(status?: ProfileProposal['status']): Promise<ProfileProposal[]> {
  const profileId = await resolveProfileId();
  if (profileId === 0) return [];
  const where = status
    ? and(eq(profileProposals.profileId, profileId), eq(profileProposals.status, status))
    : eq(profileProposals.profileId, profileId);
  const rows = await db
    .select()
    .from(profileProposals)
    .where(where)
    .orderBy(desc(profileProposals.createdAt));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    description: r.description,
    payload: JSON.parse(r.payloadJson) as Record<string, unknown>,
    status: r.status,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
  }));
}

export async function createProposal(args: {
  kind: ProfileProposal['kind'];
  description: string;
  payload: Record<string, unknown>;
}): Promise<ProfileProposal> {
  const profileId = await resolveProfileId();
  if (profileId === 0) throw new Error('No hay perfil cargado todavía.');
  const rows = await db
    .insert(profileProposals)
    .values({
      profileId,
      kind: args.kind,
      description: args.description,
      payloadJson: JSON.stringify(args.payload),
    })
    .returning();
  const r = rows[0];
  return {
    id: r.id,
    kind: r.kind,
    description: r.description,
    payload: args.payload,
    status: r.status,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
  };
}

export async function resolveProposal(args: {
  id: number;
  action: 'accepted' | 'rejected';
}): Promise<ProfileProposal | null> {
  const profileId = await resolveProfileId();
  if (profileId === 0) return null;
  const existing = await db
    .select()
    .from(profileProposals)
    .where(and(eq(profileProposals.id, args.id), eq(profileProposals.profileId, profileId)))
    .limit(1);
  if (existing.length === 0) return null;
  if (existing[0].status !== 'pending') return null; // already resolved

  await db
    .update(profileProposals)
    .set({ status: args.action, resolvedAt: new Date().toISOString() })
    .where(eq(profileProposals.id, args.id));

  const updated = await db.select().from(profileProposals).where(eq(profileProposals.id, args.id)).limit(1);
  const r = updated[0];
  return {
    id: r.id,
    kind: r.kind,
    description: r.description,
    payload: JSON.parse(r.payloadJson) as Record<string, unknown>,
    status: r.status,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
  };
}
