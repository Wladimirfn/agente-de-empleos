/**
 * Exponential backoff with jitter for challenge retries (SPEC-ID-003).
 *
 *   backoffMs(attempt) = 2_000 * 2^attempt + jitter(0..1_000)
 *
 * `attempt` is 0-based:
 *   attempt 0 → [2_000, 3_000)
 *   attempt 1 → [4_000, 5_000)
 *   attempt 2 → [8_000, 9_000)
 *
 * Caller-supplied `rand` lets tests pin the jitter to a deterministic value.
 * Default is `Math.random` which is what production code wants.
 */

const BASE_MS = 2_000;
const MAX_JITTER_MS = 1_000;

export function backoffMs(attempt: number, rand: () => number = Math.random): number {
  if (!Number.isFinite(attempt) || attempt < 0) {
    // Negative or NaN attempts collapse to the smallest valid backoff
    // (attempt=0) — keeps the function total without throwing.
    attempt = 0;
  }
  const base = BASE_MS * 2 ** Math.floor(attempt);
  // rand() is [0, 1). jitter ∈ [0, MAX_JITTER_MS).
  const jitter = Math.floor(rand() * MAX_JITTER_MS);
  return base + jitter;
}

/**
 * Lower / upper bounds for a given attempt. Tests use these to assert that
 * `backoffMs` always lands inside the expected window without pinning jitter.
 */
export function backoffBounds(attempt: number): { min: number; max: number } {
  const safeAttempt = Number.isFinite(attempt) && attempt >= 0 ? Math.floor(attempt) : 0;
  const base = BASE_MS * 2 ** safeAttempt;
  return { min: base, max: base + MAX_JITTER_MS };
}