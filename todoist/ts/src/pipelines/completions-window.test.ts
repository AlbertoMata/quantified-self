import assert from "node:assert/strict";
import { test } from "node:test";

import {
	MAX_COMPLETED_SPAN_MS,
	resolveCompletionsWindow,
} from "./completions-window.ts";

const NOW = new Date("2026-09-14T23:30:00Z");
const ninetyDaysBefore = new Date(NOW.getTime() - MAX_COMPLETED_SPAN_MS);

test("a usable cursor continues from where the last run stopped", () => {
	const window = resolveCompletionsWindow(
		"2026-09-13T23:30:00Z",
		false,
		NOW,
	);
	assert.equal(window.since.toISOString(), "2026-09-13T23:30:00.000Z");
	assert.equal(window.until, NOW);
	assert.equal(window.isBackfill, false);
});

test("an EMPTY tab ignores the cursor and refills itself", () => {
	// The case that lets you clear the tab by hand. A run that trusted the
	// cursor here would fetch the last few hours, write four rows, and leave
	// four years of history gone.
	const window = resolveCompletionsWindow(
		"2026-09-13T23:30:00Z",
		true,
		NOW,
	);
	assert.equal(
		window.since.toISOString(),
		ninetyDaysBefore.toISOString(),
	);
	assert.equal(window.isBackfill, true);
	assert.match(window.reason, /tab is empty/);
});

test("a cursor older than the API's span is clamped, not sent", () => {
	// The API hard-errors above three months, so an un-clamped window does not
	// fetch too much — it fetches NOTHING, and the run fails.
	const window = resolveCompletionsWindow(
		"2026-01-01T00:00:00Z",
		false,
		NOW,
	);
	assert.equal(
		window.since.toISOString(),
		ninetyDaysBefore.toISOString(),
	);
	assert.match(window.reason, /90 days old/);
});

test("a missing or unparseable cursor takes the full window", () => {
	for (const cursor of [null, "", "not a date"]) {
		const window = resolveCompletionsWindow(cursor, false, NOW);
		assert.equal(
			window.since.toISOString(),
			ninetyDaysBefore.toISOString(),
		);
		assert.equal(window.isBackfill, true);
	}
});

test("a cursor in the FUTURE is ignored rather than producing an empty window", () => {
	// Clock skew or a hand-edited property. [future, now] fetches nothing, so a
	// run would silently record zero completions every night — and the cursor
	// would keep being written forward, hiding it for ever.
	const window = resolveCompletionsWindow(
		"2027-01-01T00:00:00Z",
		false,
		NOW,
	);
	assert.equal(
		window.since.toISOString(),
		ninetyDaysBefore.toISOString(),
	);
	assert.equal(window.isBackfill, true);
	assert.match(window.reason, /in the future/);
});

test("the window never exceeds the API's maximum span", () => {
	// The invariant, whatever the inputs.
	for (const cursor of [
		null,
		"2020-01-01T00:00:00Z",
		"2026-09-14T00:00:00Z",
	]) {
		for (const empty of [true, false]) {
			const window = resolveCompletionsWindow(
				cursor,
				empty,
				NOW,
			);
			assert.ok(
				window.until.getTime() -
					window.since.getTime() <=
					MAX_COMPLETED_SPAN_MS,
				`span too wide for cursor=${cursor} empty=${empty}`,
			);
		}
	}
});

test("the reason is always something a log can explain a run with", () => {
	const window = resolveCompletionsWindow(
		"2026-09-13T23:30:00Z",
		false,
		NOW,
	);
	assert.ok(window.reason.length > 10);
});
