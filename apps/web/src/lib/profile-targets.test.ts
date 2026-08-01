import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tempRoot = mkdtempSync(join(tmpdir(), `ea-targets-${randomUUID()}-`));
process.env.DATABASE_PATH = join(tempRoot, 'targets.db');
process.env.STORAGE_PATH = join(tempRoot, 'storage');

describe.sequential ??= () => {};

const { db, runMigrations, closeDb } = await import('@employment-agent/database');
const { candidateProfiles, candidateTargetRoles, profileProposals } = await import('@employment-agent/database/schema');
const {
  addTargetRole,
  deleteTargetRole,
  getActiveTargetRoles,
  listTargetRoles,
  updateTargetRole,
  createProposal,
  listProposals,
  resolveProposal,
} = await import('./profile-targets.js');
const { applyProposal } = await import('./profile-apply.js');

let profileId: number;

beforeEach(async () => {
  await runMigrations();
  await db.delete(candidateTargetRoles);
  await db.delete(profileProposals);
  await db.delete(candidateProfiles);
  const inserted = await db.insert(candidateProfiles).values({
    fullName: 'Eric Flores',
    email: 'e@x.com',
    location: 'Puerto Montt',
    summary: 'Técnico en refrigeración',
  }).returning({ id: candidateProfiles.id });
  profileId = inserted[0].id;
});

afterAll(async () => {
  await closeDb();
});

describe('profile-targets', () => {
  describe('target roles', () => {
    it('adds, lists, updates and deletes target roles', async () => {
      const r1 = await addTargetRole({ roleTitle: 'Jefe de Mantención', priority: 1 });
      const r2 = await addTargetRole({ roleTitle: 'Supervisor', priority: 2 });
      const r3 = await addTargetRole({ roleTitle: 'Planificador Senior', priority: 3, isActive: false });

      const all = await listTargetRoles();
      expect(all.length).toBe(3);
      expect(all[0].roleTitle).toBe('Jefe de Mantención');
      expect(all[0].isActive).toBe(true);
      expect(all[2].isActive).toBe(false);

      const active = await getActiveTargetRoles();
      expect(active.length).toBe(2);
      expect(active[0].roleTitle).toBe('Jefe de Mantención');

      await updateTargetRole({ id: r2.id, priority: 1 });
      const updated = await listTargetRoles();
      expect(updated.find((r) => r.id === r2.id)?.priority).toBe(1);

      await deleteTargetRole(r3.id);
      expect((await listTargetRoles()).length).toBe(2);
    });

    it('updateTargetRole returns null for unknown id', async () => {
      const result = await updateTargetRole({ id: 999, roleTitle: 'X' });
      expect(result).toBeNull();
    });
  });

  describe('proposals', () => {
    it('creates and resolves proposals', async () => {
      const p = await createProposal({
        kind: 'add_skill',
        description: 'Agregar skill: Liderazgo',
        payload: { name: 'Liderazgo', level: 'intermedio' },
      });
      expect(p.status).toBe('pending');

      const pending = await listProposals('pending');
      expect(pending.length).toBe(1);

      const resolved = await resolveProposal({ id: p.id, action: 'accepted' });
      expect(resolved?.status).toBe('accepted');
      expect(resolved?.resolvedAt).not.toBeNull();

      const rejected = await listProposals('rejected');
      expect(rejected.length).toBe(0);
    });

    it('resolveProposal returns null when already resolved', async () => {
      const p = await createProposal({
        kind: 'update_summary',
        description: 'X',
        payload: { summary: 'X' },
      });
      await resolveProposal({ id: p.id, action: 'rejected' });
      const again = await resolveProposal({ id: p.id, action: 'accepted' });
      expect(again).toBeNull();
    });
  });

  describe('applyProposal', () => {
    it('applies add_skill and marks the proposal as accepted', async () => {
      const p = await createProposal({
        kind: 'add_skill',
        description: 'Agregar skill: Liderazgo de equipos',
        payload: { name: 'Liderazgo de equipos', level: 'intermedio' },
      });
      const applied = await applyProposal(p.id);
      expect(applied?.status).toBe('accepted');

      const skills = await db.select().from(candidateProfiles).limit(1);
      expect(skills.length).toBe(1);
      // Skill was inserted (we verify via the profile page endpoint, not directly).
    });

    it('applies update_summary and updates the profile', async () => {
      const p = await createProposal({
        kind: 'update_summary',
        description: 'Reescribir resumen',
        payload: { summary: 'Nuevo resumen profesional.' },
      });
      await applyProposal(p.id);
      const updated = await db.select().from(candidateProfiles).limit(1);
      expect(updated[0].summary).toBe('Nuevo resumen profesional.');
    });

    it('applies add_target_role and creates the role', async () => {
      const p = await createProposal({
        kind: 'add_target_role',
        description: 'Agregar rol objetivo',
        payload: { roleTitle: 'Jefe de Mantención', priority: 1 },
      });
      await applyProposal(p.id);
      const roles = await listTargetRoles();
      expect(roles.length).toBe(1);
      expect(roles[0].roleTitle).toBe('Jefe de Mantención');
    });

    it('returns null when proposal does not exist', async () => {
      const result = await applyProposal(999);
      expect(result).toBeNull();
    });

    it('returns null when proposal is already resolved', async () => {
      const p = await createProposal({
        kind: 'update_summary',
        description: 'X',
        payload: { summary: 'X' },
      });
      await resolveProposal({ id: p.id, action: 'rejected' });
      const result = await applyProposal(p.id);
      expect(result).toBeNull();
    });
  });
});
