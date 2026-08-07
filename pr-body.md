# Summary

Process stability improvements for the worker:

## Changes

1. **Global safety net handlers** (worker/src/index.ts)
   - unhandledRejection: log full context, keep alive
   - uncaughtException: log, keep alive (documented tradeoff)

2. **Retry helper** (packages/database/src/retry.ts, exported from @employment-agent/database)
   - runWithLockRetry(fn, { attempts, baseDelayMs, operation }) - exponential backoff with jitter
   - isTransientLockError(err) - detects SQLITE_BUSY, SQLITE_BUSY_SNAPSHOT, and "database is locked" message

3. **Applied to critical paths**
   - runMigrations: 5 attempts x 200ms base (~3s budget)
   - markFailed / markCompleted / markRetrying: 3 attempts x 50ms base

4. **Removed decorative exit code**
   - Was: exit(isTransient ? 2 : 1) with claim "supervisor can restart"
   - Now: always exit(1) with honest comment - concurrently doesn't distinguish exit codes without explicit flags

5. **Fixed JSDoc** on runWithLockRetry to match behavior (logs final failure, not every attempt)

6. **Restored PID file cleanup** in main().catch() - prevents stale PID on boot failure after writePidFile()

7. **Full CDP browser architecture** (worker/src/browser-detector.ts, browser-launcher.ts, browser-tools.ts, browser-agent.ts, task-runner.ts)
   - Detects installed browsers: Brave (preferred) > Chrome > Edge > Comet
   - Connects to existing Brave on port 9222 (reuses your open session with cookies/login)
   - If no browser running, launches new Brave with persistent profile (--user-data-dir + --remote-debugging-port)
   - Browser-tools picks the context with cookies for the target platform
   - Only closes pages the AGENT opened — NEVER touches user's localhost tab or other tabs
   - Brave shields disabled via flags so Indeed/other platforms don't block
   - Works for ALL platforms (Indeed, Laborum, Computrabajo, Trabajando, EmpleosAqua, ChileTrabajos, etc.)

## Testing

- 13 new tests covering retry success, exhaustion, non-transient pass-through
- Integration tests against real SQLite DB with artificial lock contention
- Browser origin pinning tests (3 tests) pass with Brave
- Full suite: 663/663 passing, typecheck clean

## Review notes

- R1-R4 reviews completed (WARNING / WARNING / CRITICAL-FIXED / WARNING)
- CRITICAL finding (decorative exit code) resolved in this PR
- PID cleanup regression caught by sdd-verify and fixed
- Full CDP architecture restores real browser sessions for ALL platforms
- Remaining SUGGESTIONS (claimNextTask retry, jitter, uncaughtException exit) tracked for follow-up PRs