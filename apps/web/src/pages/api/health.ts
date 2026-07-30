import type { APIRoute } from 'astro';
import { db } from '@employment-agent/database';
import { platformSkills, platforms, skillHealthchecks, skillFailures } from '@employment-agent/database/schema';
import { desc, eq, sql } from 'drizzle-orm';
import type { HealthResponse, SkillHealthSummary, SkillStatus } from '../../lib/health-types';

export const prerender = false;

/**
 * GET /api/health
 * Devuelve el estado de cada skill instalada, combinando:
 *  - último healthcheck
 *  - fallas en últimas 24h
 *  - fallas sin reparar
 *  - contador de fallas consecutivas
 *
 * Si el worker aún no corrió, devuelve skills vacíos (hasData: false).
 */
export const GET: APIRoute = async () => {
  // Traemos las skills instaladas + info de la plataforma
  const rows = await db
    .select({
      skillSlug: platformSkills.skillSlug,
      lastSuccessAt: platformSkills.lastSuccessAt,
      consecutiveFailures: platformSkills.consecutiveFailures,
      platformSlug: platforms.slug,
      platformDisplayName: platforms.displayName,
      platformStatus: platforms.status,
    })
    .from(platformSkills)
    .leftJoin(platforms, eq(platforms.id, platformSkills.platformId));

  // Para cada skill, buscamos su último healthcheck y contadores de fallas.
  // Hacemos N+1 queries a propósito: con libsql y < 10 skills es más rápido que
  // un único mega-SQL. Si el proyecto crece, podemos consolidar.
  const skills: SkillHealthSummary[] = await Promise.all(
    rows.map(async (row): Promise<SkillHealthSummary> => {
      const latestHc = await db
        .select({ status: skillHealthchecks.status, checkedAt: skillHealthchecks.checkedAt })
        .from(skillHealthchecks)
        .where(eq(skillHealthchecks.skillSlug, row.skillSlug))
        .orderBy(desc(skillHealthchecks.checkedAt))
        .limit(1);

      const failures24h = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(skillFailures)
        .where(sql`${skillFailures.skillSlug} = ${row.skillSlug} AND ${skillFailures.occurredAt} > datetime('now', '-24 hours')`);

      const unrepaired = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(skillFailures)
        .where(sql`${skillFailures.skillSlug} = ${row.skillSlug} AND ${skillFailures.repairedAt} IS NULL`);

      const hc = latestHc[0];
      const hasData = Boolean(hc) || row.consecutiveFailures > 0 || row.lastSuccessAt !== null;
      const latestStatus: SkillStatus = hc?.status ?? (hasData ? 'unknown' : 'unknown');

      return {
        skillSlug: row.skillSlug,
        platformSlug: row.platformSlug,
        platformDisplayName: row.platformDisplayName,
        platformStatus: row.platformStatus,
        latestStatus,
        latestCheckedAt: hc?.checkedAt ?? null,
        lastSuccessAt: row.lastSuccessAt,
        consecutiveFailures: row.consecutiveFailures,
        failuresLast24h: Number(failures24h[0]?.count ?? 0),
        unrepairedFailures: Number(unrepaired[0]?.count ?? 0),
        hasData,
      };
    }),
  );

  const body: HealthResponse = {
    skills,
    generatedAt: new Date().toISOString(),
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};