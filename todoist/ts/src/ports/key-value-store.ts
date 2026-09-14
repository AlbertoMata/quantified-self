// ─────────────────────────────────────────────────────────────────────────────
// KeyValueStore — durable state that outlives a run
//
// Two values live here and both are load-bearing: TODOIST_LAST_SYNC, the cursor
// that decides which completion window is fetched next, and
// TODOIST_IN_REVIEW_PREV, the membership snapshot that turns "in the In Review
// section" into a completion event exactly once.
//
// ⚠️ THE SHARPEST EDGE IN THE PORT. Under Apps Script this is Script Properties,
// which are per-project — and the port now develops INSIDE the production
// project, so it shares one store with the running legacy sync. If the port
// advances TODOIST_LAST_SYNC, the legacy nightly run skips that window and
// Completions loses rows: corruption at a distance, in a tab the port never
// wrote, invisible until someone spots the gap months later.
//
// The rail is a naming rule — every key the port writes starts with PORT_ — and
// B4b makes the GAS adapter refuse anything else. Reading a legacy key is fine
// and necessary; writing one is not.
// ─────────────────────────────────────────────────────────────────────────────

export interface KeyValueStore {
	// The stored value, or null if the key has never been set. Null rather than
	// a default, because "no cursor yet" is a real state with its own branch:
	// the first Completions run backfills instead of fetching a window.
	read(key: string): string | null;

	// Persisted only AFTER the rows they describe have landed. A cursor written
	// before its rows is a cursor that skips them if the run dies in between,
	// and the 6-minute cap makes dying mid-run a real possibility rather than a
	// theoretical one. The WritePlan keeps state separate from writes for
	// exactly this ordering.
	write(key: string, value: string): void;
}
