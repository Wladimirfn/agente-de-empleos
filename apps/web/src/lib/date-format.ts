/**
 * Timezone-aware date formatting for Chilean market.
 *
 * The worker stores UTC ISO strings everywhere (job.firstSeenAt,
 * application.preparedAt, event.occurredAt, etc). JavaScript's
 * `toLocaleString()` would convert those to the BROWSER's local timezone
 * — which is fine when the user's OS is configured correctly, but on
 * Windows machines that were never set up, in Docker containers, or in
 * CI runners, the browser reports UTC and the user sees times that are
 * hours off from their wall clock.
 *
 * This helper picks the right timezone automatically:
 *   1. If the browser reports a non-UTC timezone, use it (the OS knows best).
 *   2. Otherwise, default to America/Santiago (this app targets the Chilean
 *      market; UTC is almost never the user's actual timezone).
 *
 * The "auto-detect region" the user asked for is honestly impossible
 * from JavaScript without a geolocation API permission gate. The OS
 * timezone is the closest equivalent and what every other app does.
 *
 * Override via `import.meta.env.PUBLIC_TIMEZONE` if you deploy outside Chile.
 */

const CACHED_TZ: string | null = null;

function resolveTimeZone(): string {
  if (CACHED_TZ) return CACHED_TZ;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    if (tz && tz !== 'UTC') return tz;
  } catch {
    // SSR / Node without ICU — fall through.
  }
  const override = (import.meta as { env?: Record<string, string | undefined> }).env?.PUBLIC_TIMEZONE;
  return override && override.length > 0 ? override : 'America/Santiago';
}

const TZ = resolveTimeZone();

export function formatLocalDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('es-CL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: TZ,
  });
}

export function formatLocalDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('es-CL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: TZ,
  });
}