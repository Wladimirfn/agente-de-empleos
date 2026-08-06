import { registry } from '@employment-agent/skill-runtime';
import { db } from '@employment-agent/database';
import { platforms, platformSkills } from '@employment-agent/database/schema';
import { eq } from 'drizzle-orm';
import { laborumSkill } from '../../skills/laborum/index.js';
import { computrabajoSkill } from '../../skills/computrabajo/index.js';
import { indeedSkill } from '../../skills/indeed/index.js';
import { chiletrabajosSkill } from '../../skills/chiletrabajos/index.js';
import { empleosaquaSkill } from '../../skills/empleosaqua/index.js';
import { trabajandoSkill } from '../../skills/trabajando/index.js';

export const productionSkills = [laborumSkill, computrabajoSkill, indeedSkill, chiletrabajosSkill, empleosaquaSkill, trabajandoSkill] as const;

async function ensurePlatform(slug: string, displayName: string, baseUrl?: string): Promise<number> {
  const existing = await db.select().from(platforms).where(eq(platforms.slug, slug)).limit(1);
  if (existing[0]) {
    if (baseUrl && !existing[0].baseUrl) {
      await db.update(platforms).set({ baseUrl }).where(eq(platforms.id, existing[0].id));
    }
    return existing[0].id;
  }
  const inserted = await db
    .insert(platforms)
    .values({ slug, displayName, status: 'active', baseUrl: baseUrl ?? null })
    .returning({ id: platforms.id });
  return inserted[0]!.id;
}

/**
 * Register the deterministic skills in the in-memory registry. Synchronous
 * on purpose: the registry guards against double registration by throwing,
 * and the boot path relies on that synchronous contract.
 *
 * Also kicks off persistence of the registry into platform_skills (async,
 * best-effort), so the web server (chat tools, platforms page) can tell
 * which platforms have a deterministic scraper and which ones can only be
 * scanned by the LLM browser agent.
 */
export function initializeSkills(): void {
  for (const skill of productionSkills) registry.register(skill);
  for (const skill of registry.list()) {
    console.log(`[skills] registered ${skill.slug} v${skill.version} — ${skill.displayName}`);
  }
  void persistRegisteredSkills();
}

async function persistRegisteredSkills(): Promise<void> {
  const { platformUrlForSlug } = await import('./platform-urls.js');
  for (const skill of registry.list()) {
    try {
      const platformId = await ensurePlatform(skill.slug, skill.displayName, platformUrlForSlug(skill.slug));
      await db.insert(platformSkills).values({
        platformId,
        skillSlug: skill.slug,
        version: skill.version,
      }).onConflictDoUpdate({
        target: [platformSkills.platformId, platformSkills.skillSlug],
        set: { version: skill.version },
      });
    } catch (err) {
      console.error(`[skills] failed to persist skill ${skill.slug}:`, err);
    }
  }
}
