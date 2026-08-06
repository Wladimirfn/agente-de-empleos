/**
 * SQLite lock detection and retry helper, shared between the database
 * package (`runMigrations`) and the worker (`markFailed` / `markCompleted` /
 * `markRetrying`). Exported so the worker can test the helper directly
 * without going through the drizzle Proxy (which can't be vi.spyOn'd).
 */

export function isTransientLockError(err: unknown): boolean {
  if (!err) return false;
  const code = (err as { code?: string }).code;
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_BUSY_SNAPSHOT') return true;
  const message = err instanceof Error ? err.message : String(err);
  return /database is locked|sqlite_busy/i.test(message);
}

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  operation: string;
}

/**
 * Run an async function with bounded exponential backoff on transient
 * SQLite lock errors. Other errors propagate immediately (single
 * attempt). Logs every retried attempt to stderr; throws after the
 * budget is exhausted.
 */
export async function runWithLockRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransientLockError(err) || attempt === opts.attempts) {
        console.error(
          `[database] ${opts.operation} failed (attempt ${attempt}/${opts.attempts}):`,
          err,
        );
        throw err;
      }
      const backoffMs = opts.baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw lastError;
}
