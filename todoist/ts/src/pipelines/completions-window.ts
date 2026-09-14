// ─────────────────────────────────────────────────────────────────────────────
// Which window of time a Completions run should fetch
//
// Pure, and separated from the pipeline because it is the decision most likely
// to be wrong in a way nobody notices: a window that is too SHORT loses
// completions permanently, and one that is too LONG is rejected outright by the
// API.
// ─────────────────────────────────────────────────────────────────────────────

// The API hard-errors above a three-month span ("must not exceed 3 months").
// This cap is correct PER REQUEST — it is not a limit on total reachable
// history, which is what a backfill loop is for.
export const MAX_COMPLETED_SPAN_MS = 90 * 86_400_000;

export interface CompletionsWindow {
	readonly since: Date;
	readonly until: Date;
	// True when the cursor was ignored and a full backfill window used instead.
	// Worth logging: it explains a run that suddenly fetches thousands of rows.
	readonly isBackfill: boolean;
	readonly reason: string;
}

// Work out the window from the cursor, the tab, and now.
//
// THREE CASES, and the second is the one that matters:
//
//   1. A usable cursor        → [cursor, now]
//   2. An EMPTY tab           → ignore the cursor, take the full 90 days
//   3. A cursor older than 90 days → clamp, because the API would reject it
//
// Case 2 is what lets you clear the tab by hand and have it refill itself. A
// run that trusted the cursor on an empty tab would fetch the last few hours,
// write four rows, and leave four years of history gone.
export function resolveCompletionsWindow(
	lastSyncedAt: string | null,
	tabIsEmpty: boolean,
	now: Date,
): CompletionsWindow {
	const fullWindowStart = new Date(now.getTime() - MAX_COMPLETED_SPAN_MS);

	if (tabIsEmpty) {
		return {
			since: fullWindowStart,
			until: now,
			isBackfill: true,
			reason: "the tab is empty, so the cursor is ignored and it refills itself",
		};
	}

	const cursor = lastSyncedAt ? new Date(lastSyncedAt) : null;
	if (!cursor || Number.isNaN(cursor.getTime())) {
		return {
			since: fullWindowStart,
			until: now,
			isBackfill: true,
			reason: "no usable cursor, so the full window is fetched",
		};
	}

	// A cursor in the FUTURE means something wrote it wrong — a clock skew, or a
	// hand-edited property. Fetching [future, now] is an empty window that would
	// silently record nothing every night, so treat it as unusable.
	if (cursor.getTime() > now.getTime()) {
		return {
			since: fullWindowStart,
			until: now,
			isBackfill: true,
			reason: `the cursor (${lastSyncedAt}) is in the future, so it is ignored`,
		};
	}

	if (now.getTime() - cursor.getTime() > MAX_COMPLETED_SPAN_MS) {
		return {
			since: fullWindowStart,
			until: now,
			isBackfill: false,
			reason:
				"the cursor is over 90 days old, clamped to the API's maximum span " +
				"— anything older needs a backfill run",
		};
	}

	return {
		since: cursor,
		until: now,
		isBackfill: false,
		reason: "continuing from the cursor",
	};
}
