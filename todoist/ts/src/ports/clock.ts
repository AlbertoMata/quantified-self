// ─────────────────────────────────────────────────────────────────────────────
// Clock — the current time, and the only legitimate way to pause
//
// "What day is it" decides which rows a nightly run writes, so it must be
// injectable: a pipeline that reads the wall clock directly cannot be tested
// against the 2026-08-20 UTC-vs-local bug that history.md records, and cannot
// be replayed for a backfill.
//
// TIMEZONE IS NOT HERE, deliberately. Session.getScriptTimeZone() is deleted in
// the port: a GitHub runner is UTC and has no ambient script timezone, so the
// zone becomes an explicit config value and formatting a day becomes a pure
// function of (instant, timezone) in core/dates.ts. A Clock that knew the
// timezone would re-create the ambient read this port exists to remove.
// ─────────────────────────────────────────────────────────────────────────────

export interface Clock {
	// The current instant. A Date carries no timezone — it is a moment — which
	// is the whole point: turning it into a calendar day is a separate,
	// testable decision.
	now(): Date;

	// Block for this long. Only for API courtesy delays — the legacy paginator
	// sleeps 300ms between pages and the Completions windower 400ms between
	// windows, both to stay clear of Todoist's per-token rate limit.
	//
	// It lives on Clock because it is the only other thing in the codebase that
	// consumes wall time, and because a test needs it to be a no-op: a fake
	// that actually slept would add minutes to the suite for no signal. It is
	// also the one method here that spends the 6-minute execution budget, so
	// treat every call as a deliberate cost.
	sleep(milliseconds: number): void;
}
