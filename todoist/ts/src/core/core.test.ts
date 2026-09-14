// C2 — labels, numbers and the dedup keys.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
	canonicalInstant,
	completionKey,
	completionKeyFromRow,
	habitDayKey,
	keySetFromRows,
} from "./keys.ts";
import {
	extractComplexity,
	hasLabel,
	shortHabitName,
	toLabelList,
} from "./labels.ts";
import { durationMinutes, toNumberOrNull, toNumberOrZero } from "./numbers.ts";

// ── labels ───────────────────────────────────────────────────────────────────

test("labels are read from an API array or a sheet cell alike", () => {
	// Callers exist on both sides: a pipeline reading live tasks, and one
	// re-reading a tab it wrote last night.
	assert.deepEqual(toLabelList(["area-work", "5"]), ["area-work", "5"]);
	assert.deepEqual(toLabelList("area-work, 5"), ["area-work", "5"]);
});

test("a trailing comma does not produce a phantom label", () => {
	// An empty label matches nothing and quietly changes a count.
	assert.deepEqual(toLabelList("area-work,"), ["area-work"]);
	assert.deepEqual(toLabelList(",,"), []);
	assert.deepEqual(toLabelList(""), []);
	assert.deepEqual(toLabelList(null), []);
});

test("label matching is exact, not a prefix match", () => {
	// `area-work` must not match `area-workshop`, or a project could be filed
	// under an area nobody assigned it.
	assert.equal(hasLabel(["area-work"], "area-work"), true);
	assert.equal(hasLabel(["area-workshop"], "area-work"), false);
});

test("complexity is the first digits-only label", () => {
	assert.equal(extractComplexity(["high-priority", "5", "backend"]), 5);
	assert.equal(extractComplexity(["3", "8"]), 3);
});

test("no estimate is null, not zero", () => {
	// "No estimate" and "estimated at zero" are different facts; averaging them
	// together would flatter the numbers.
	assert.equal(extractComplexity(["area-work"]), null);
	assert.equal(extractComplexity([]), null);
	assert.equal(extractComplexity("p1"), null);
});

test("a label that merely contains digits is not an estimate", () => {
	assert.equal(extractComplexity(["v2", "2h"]), null);
});

test("a habit name is split on the first ' - ' only", () => {
	assert.equal(
		shortHabitName(
			"Drink Water - Drink water early in the morning",
		),
		"Drink Water",
	);
	assert.equal(
		shortHabitName("Read - 20 pages - every evening"),
		"Read",
		"only the first separator counts",
	);
});

test("a genuinely hyphenated title is left alone", () => {
	// The reason the separator requires surrounding whitespace.
	assert.equal(shortHabitName("Work-life balance"), "Work-life balance");
	assert.equal(shortHabitName("Stretch"), "Stretch");
	assert.equal(shortHabitName(""), "");
});

// ── numbers ──────────────────────────────────────────────────────────────────

test("a blank sums as zero rather than poisoning the total", () => {
	// One NaN in a running total blanks an entire column.
	assert.equal(toNumberOrZero(""), 0);
	assert.equal(toNumberOrZero(null), 0);
	assert.equal(toNumberOrZero("nonsense"), 0);
	assert.equal(toNumberOrZero("42"), 42);
	assert.equal(toNumberOrZero(42), 42);
});

test("the honest counterpart keeps absence distinguishable from zero", () => {
	assert.equal(toNumberOrNull(""), null);
	assert.equal(toNumberOrNull(null), null);
	assert.equal(toNumberOrNull("nonsense"), null);
	assert.equal(toNumberOrNull(0), 0, "an observed zero survives");
});

test("durations convert to whole minutes", () => {
	assert.equal(durationMinutes({ amount: 90, unit: "minute" }), 90);
	assert.equal(durationMinutes({ amount: 2, unit: "hour" }), 120);
	assert.equal(durationMinutes({ amount: 1.5, unit: "hour" }), 90);
});

test("a missing duration is null, not zero minutes", () => {
	assert.equal(durationMinutes(null), null);
	assert.equal(durationMinutes({}), null);
	assert.equal(durationMinutes({ amount: 0, unit: "minute" }), null);
});

// ── dedup keys ───────────────────────────────────────────────────────────────

test("a recurring task's completions are distinct keys", () => {
	// THE bug this shape exists to prevent: a recurring task reuses the same
	// task_id every time it is checked off. Deduping on id alone would keep the
	// first completion of "Drink Water" and discard every one after it, making
	// the entire history of every habit invisible.
	const monday = completionKey("6cWpJ9", "2026-09-14T07:02:00");
	const tuesday = completionKey("6cWpJ9", "2026-09-15T07:11:00");
	assert.notEqual(monday, tuesday);
});

test("the same completion produces the same key from either side", () => {
	// A task id arrives as a number from the API and a string from a sheet;
	// 123 !== "123" would make every re-read miss and duplicate the row.
	assert.equal(
		completionKey(123, "2026-09-14T07:02:00"),
		completionKey("123", "2026-09-14T07:02:00"),
	);
});

test("reading a row back inverts the column order correctly", () => {
	// The Completions schema is completed_at first, then task_id — the one
	// inversion worth keeping in a named place rather than at each call site.
	assert.equal(
		completionKeyFromRow("2026-09-14T07:02:00", "6cWpJ9"),
		completionKey("6cWpJ9", "2026-09-14T07:02:00"),
	);
});

test("two different pairs cannot collide into one key", () => {
	// The reason the separator is a pipe: a hyphen or colon occurs inside ISO
	// timestamps, and a separator that appears in its own operands collides.
	assert.notEqual(
		completionKey("6cW", "pJ9|2026"),
		completionKey("6cWpJ9", "2026"),
	);
});

test("a Date cell and its ISO string produce the SAME completion key", () => {
	// The bug this prevents is the worst one available: String(aDate) gives
	// "Sun Sep 14 2026 07:02:00 GMT-0600", which matches no ISO string ever
	// written — so the key misses on every re-read and Completions re-appends
	// its entire recent history every night, in the one tab that cannot be
	// re-fetched.
	const iso = "2026-09-14T13:02:00.000Z";
	assert.equal(
		completionKey("6cWpJ9", new Date(iso)),
		completionKey("6cWpJ9", iso),
	);
});

test("milliseconds do not split one completion into two keys", () => {
	// The API sends "2026-09-14T13:02:00Z"; a round-tripped cell comes back with
	// ".000". They are the same moment.
	assert.equal(
		completionKey("6cWpJ9", "2026-09-14T13:02:00Z"),
		completionKey("6cWpJ9", "2026-09-14T13:02:00.000Z"),
	);
});

test("a bare day is not silently promoted to midnight UTC", () => {
	// A day is not an instant. Reformatting it would invent a time it never had.
	assert.equal(canonicalInstant("2026-09-14"), "2026-09-14");
});

test("an unparseable value is compared literally rather than invented", () => {
	assert.equal(canonicalInstant("not a timestamp"), "not a timestamp");
	assert.equal(canonicalInstant(new Date("nonsense")), "");
	assert.equal(canonicalInstant(null), "");
});

test("a habit-day key normalises a Date cell and a string alike", () => {
	assert.equal(
		habitDayKey("6cWpJ9", new Date("2026-09-14T00:00:00Z")),
		habitDayKey("6cWpJ9", "2026-09-14"),
	);
});

test("a key set skips rows with no id rather than admitting a blank", () => {
	// A blank key would make the NEXT blank-id row look like a duplicate and
	// silently drop it.
	const rows = [
		["2026-09-14T07:02:00", "6cWpJ9"],
		["", ""],
	];
	const keys = keySetFromRows(rows, (row) =>
		completionKeyFromRow(row[0], row[1]),
	);
	assert.equal(keys.size, 1);
	assert.equal(
		keys.has(completionKey("6cWpJ9", "2026-09-14T07:02:00")),
		true,
	);
});

test("a key set answers membership without a linear scan", () => {
	// 3,000 existing rows against 200 new completions is 600,000 comparisons as
	// a scan — which is how a nightly run finds the 6-minute cap.
	const rows = Array.from({ length: 3000 }, (_, index) => [
		`2026-09-14T07:${String(index % 60).padStart(2, "0")}:00`,
		`task-${index}`,
	]);
	const keys = keySetFromRows(rows, (row) =>
		completionKeyFromRow(row[0], row[1]),
	);
	assert.equal(keys.size, 3000);
	assert.equal(
		keys.has(completionKey("task-2999", "2026-09-14T07:59:00")),
		true,
	);
});
