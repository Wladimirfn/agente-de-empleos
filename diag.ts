import { db, closeDb } from '@employment-agent/database';
import { applicationEvents } from '@employment-agent/database/schema';
import { desc, sql } from 'drizzle-orm';

async function main() {
  const recent = await db.select({
    kind: applicationEvents.kind,
    message: applicationEvents.message,
    payloadJson: applicationEvents.payloadJson,
    occurredAt: applicationEvents.occurredAt,
  }).from(applicationEvents)
    .where(sql`kind LIKE 'agent_%' OR kind = 'real_browser_%' OR kind = 'platform_blocked'`)
    .orderBy(desc(applicationEvents.id))
    .limit(30);
  console.log(`Recent browser-agent events (newest first):`);
  for (const e of recent) {
    const t = e.occurredAt;
    console.log(`  [${t}] ${e.kind}`);
    if (e.message && e.message !== e.kind) console.log(`    msg: ${e.message.slice(0, 150)}`);
  }
  await closeDb();
}
main().catch(console.error);