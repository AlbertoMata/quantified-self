// ─────────────────────────────────────────────────────────────────────────────
// IdGenerator — the seventh port, which the plan's list of six had missed
//
// Todoist's /sync endpoint requires a client-generated uuid per command, and it
// uses that uuid for idempotency: replaying a command with the same uuid is a
// no-op rather than a second write. The legacy reschedule path calls
// Utilities.getUuid() to produce it — a platform global, so it cannot appear
// above the seam, and it has no home in HttpTransport, TableStore,
// KeyValueStore, CacheStore, Clock or Logger.
//
// It is its own port rather than a method on Clock because it is a different
// kind of nondeterminism, and because a fake that returns "uuid-1", "uuid-2"
// makes the command-builder tests in D11 read exactly as they should.
//
// This is the only write path to Todoist in the whole system, so the
// idempotency key it produces is the thing standing between a retried run and
// a double reschedule.
// ─────────────────────────────────────────────────────────────────────────────

export interface IdGenerator {
	newUuid(): string;
}
