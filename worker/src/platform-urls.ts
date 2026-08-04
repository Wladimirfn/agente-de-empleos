/**
 * Returns the canonical URL for a given platform slug. Single source
 * of truth — used by the worker when scanning platforms and by the
 * database backfill to populate missing baseUrl values.
 *
 * Special cases worth noting:
 * - empleosaqua is .com (not .cl). The actual Empleos Aqua site lives
 *   at empleosaqua.com — using .cl would 404.
 * - indeed is cl.indeed.com (no www).
 * - everything else is www.<slug>.cl.
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
      return 'https://www.empleosaqua.com';
    case 'trabajando':
      return 'https://www.trabajando.cl';
    default:
      // Best-effort fallback. Some platforms (e.g. example-platform)
      // don't have a real URL — the scan API will reject them.
      return `https://www.${slug}.cl`;
  }
}
