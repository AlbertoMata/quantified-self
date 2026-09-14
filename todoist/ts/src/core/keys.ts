// ─────────────────────────────────────────────────────────────────────────────
// Dedup keys
//
// `Completions` is append-only and its rows cannot be re-fetched once Todoist's
// activity log ages out, so deciding "have I already recorded this?" is the
// single highest-consequence comparison in the project. Getting it wrong in one
// direction duplicates history; in the other it silently drops it.
//
// THE BUG THIS SHAPE PREVENTS, recorded in the legacy comment: a recurring task
// reuses the SAME task_id every time it is checked off — only the completion
// timestamp differs. Deduping on task_id alone would therefore keep the first
// completion of "Drink Water" and discard every one after it, making the entire
// history of every recurring habit invisible. The key must carry both.
// ─────────────────────────────────────────────────────────────────────────────

import { cellValueToDayKey } from "./dates.ts";

// The separator. A pipe rather than a hyphen or colon because both of those
// appear inside ISO timestamps, and a separator that occurs in its own operands
// is how two different pairs collide into one key.
const KEY_SEPARATOR = "|";

// Canonicalise a completion instant.
//
// ⚠️ THE SUBTLE ONE. Sheets returns a real Date once a cell is date-formatted,
// and `String(aDate)` gives "Sun Sep 14 2026 07:02:00 GMT-0600" — which matches
// no ISO string ever written. The key would then miss on every re-read and
// Completions would RE-APPEND ITS ENTIRE RECENT HISTORY every night, silently,
// in the one tab whose rows cannot be re-fetched.
//
// So both shapes are normalised to the same instant. A string that parses as a
// timestamp is reformatted too, which makes "2026-09-14T13:02:00Z" and
// "2026-09-14T13:02:00.000Z" the same key — the API and a round-tripped cell
// disagree on milliseconds, and they mean the same moment.
//
// Anything that does not parse is passed through untouched: a key is only
// useful if it is stable, and inventing a timestamp for an unparseable value
// would be worse than comparing it literally.
export function canonicalInstant(value: unknown): string {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? "" : value.toISOString();
	}
	if (value === null || value === undefined) return "";

	const text = String(value).trim();
	// Only reformat something that actually looks like an ISO timestamp. A bare
	// "2026-09-14" is a day, not an instant, and must not silently become
	// midnight UTC.
	if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text)) return text;

	const parsed = new Date(text);
	return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

// The Completions dedup key: task_id + completion instant.
//
// The id is stringified rather than trusted: it arrives as a number from the API
// and a string from a sheet, and `123 !== "123"` would make every re-read miss.
export function completionKey(taskId: unknown, completedAt: unknown): string {
	return `${String(taskId ?? "")}${KEY_SEPARATOR}${canonicalInstant(completedAt)}`;
}

// The same key, read back off a Completions row.
//
// Column order is the schema's: completed_at first, then task_id — which is why
// the legacy code builds the key as `r[1]|r[0]`. Keeping that inversion in one
// named place rather than at each call site is the point of this function.
export function completionKeyFromRow(
	completedAtCell: unknown,
	taskIdCell: unknown,
): string {
	return completionKey(taskIdCell, completedAtCell);
}

// The HabitDaily grid key: one cell per habit per day.
//
// The grid is dense — it carries a row for a day a habit was skipped, which is
// the whole reason RecurringStatus exists — so the key has to identify a
// (habit, day) slot that may hold no completion at all.
export function habitDayKey(taskId: unknown, day: unknown): string {
	return `${String(taskId ?? "")}${KEY_SEPARATOR}${cellValueToDayKey(day)}`;
}

// The AreaDaily key: one row per area per day.
export function areaDayKey(area: unknown, day: unknown): string {
	return `${String(area ?? "")}${KEY_SEPARATOR}${cellValueToDayKey(day)}`;
}

// Build a lookup set from rows already in a tab.
//
// Returns a Set rather than an array because the caller is asking "is this one
// already there?" once per incoming row: a linear scan turns a 3,000-row tab and
// 200 new completions into 600,000 comparisons, which is how a nightly run
// discovers the 6-minute execution cap.
export function keySetFromRows<Row>(
	rows: readonly Row[],
	keyOf: (row: Row) => string,
): Set<string> {
	const keys = new Set<string>();
	for (const row of rows) {
		const key = keyOf(row);
		// An empty key means the row had no id — including it would make the
		// next blank-id row look like a duplicate and silently drop it.
		if (key !== KEY_SEPARATOR && key !== "") keys.add(key);
	}
	return keys;
}
