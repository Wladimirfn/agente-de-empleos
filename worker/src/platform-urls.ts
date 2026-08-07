/**
 * Returns the canonical URL for a given platform slug. Single source
 * of truth — used by the worker when scanning platforms and by the
 * database backfill to populate missing baseUrl values.
 *
 * Special cases worth noting:
 * - indeed is cl.indeed.com (no www).
 * - everything else is www.<slug>.cl.
 *
 * Earlier this file returned www.empleosaqua.com for Empleos Aqua, but
 * that hostname does not resolve (NXDOMAIN). The actual site lives at
 * www.empleosaqua.cl. The old value was kept around as a footgun until
 * 2026-08 when the LLM agent's wait_human for the dead URL surfaced it.
 */
export function platformUrlForSlug(slug: string): string {
  switch (slug) {
    case 'laborum':
      return 'https://www.laborum.cl';
    case 'computrabajo':
      return 'https://www.computrabajo.cl';
    case 'indeed':
      return 'https://cl.indeed.com';
    case 'chiletrabajos':
      return 'https://www.chiletrabajos.cl';
    case 'empleosaqua':
      return 'https://www.empleosaqua.cl';
    case 'trabajando':
      return 'https://www.trabajando.cl';
    default:
      // Best-effort fallback. Some platforms (e.g. example-platform)
      // don't have a real URL — the scan API will reject them.
      return `https://www.${slug}.cl`;
  }
}