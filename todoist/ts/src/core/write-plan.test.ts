// The three verbs, against an in-memory table.
//
// These are the tests that matter most in Phase B: eight tabs will route their
// every write through this resolver, so a bug here is a bug in all of them at
// once — including the two whose history cannot be re-fetched from anywhere.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Row } from "../ports/values.ts";
import {
	appendTo,
	replaceWhere,
	resolveWriteOperation,
	upsertBy,
	type TableMutation,
} from "./write-plan.ts";

const HEADER: Row = ["day", "task_id", "count"];

// A tab as the sheet would return it: header first, then rows in append order.
function tab(...rows: Row[]): Row[] {
	return [HEADER, ...rows];
}

// Perform mutations against a plain array so the verbs can be asserted on their
// effect rather than their shape. Mirrors what the GAS TableStore will do:
// clearing blanks rows in place, writing lands on top, appending extends.
function applyToRows(rows: Row[], mutations: TableMutation[]): Row[] {
	let result = [...rows];
	for (const mutation of mutations) {
		if (mutation.kind === "clearFrom") {
			result = result.slice(0, mutation.firstRow - 1);
		} else if (mutation.kind === "write") {
			const next = [...result];
			mutation.rows.forEach((row, offset) => {
				next[mutation.firstRow - 1 + offset] = row;
			});
			result = next;
		} else {
			result = [...result, ...mutation.rows];
		}
	}
	return result;
}

// ── append ───────────────────────────────────────────────────────────────────

test("append adds rows and touches nothing existing", () => {
	const existing = tab(["2026-09-12", "a", 1], ["2026-09-13", "b", 2]);
	const mutations = resolveWriteOperation(
		existing,
		appendTo("Completions_port", [["2026-09-14", "c", 3]]),
	);

	assert.deepEqual(mutations, [
		{ kind: "append", rows: [["2026-09-14", "c", 3]] },
	]);
	assert.deepEqual(applyToRows(existing, mutations).length, 4);
});

test("appending nothing produces no mutation at all", () => {
	// A no-op must stay a no-op: an empty write that still cleared or touched
	// the tab would make every quiet day a risk.
	const mutations = resolveWriteOperation(
		tab(["2026-09-13", "b", 2]),
		appendTo("Completions_port", []),
	);
	assert.deepEqual(mutations, []);
});

// ── replaceWhere: equals ─────────────────────────────────────────────────────

test("replaceWhere equals swaps today's rows and leaves history alone", () => {
	const existing = tab(
		["2026-09-12", "a", 1],
		["2026-09-13", "b", 2],
		["2026-09-14", "old-1", 9],
		["2026-09-14", "old-2", 9],
	);
	const mutations = resolveWriteOperation(
		existing,
		replaceWhere("Overdue_port", 0, { equals: "2026-09-14" }, [
			["2026-09-14", "new", 1],
		]),
	);

	// Clears from the first of today's rows (sheet row 4), then writes there.
	assert.deepEqual(mutations, [
		{ kind: "clearFrom", firstRow: 4 },
		{
			kind: "write",
			firstRow: 4,
			rows: [["2026-09-14", "new", 1]],
		},
	]);

	const after = applyToRows(existing, mutations);
	assert.deepEqual(
		after,
		tab(
			["2026-09-12", "a", 1],
			["2026-09-13", "b", 2],
			["2026-09-14", "new", 1],
		),
	);
});

test("replaceWhere appends when the day is not present yet", () => {
	// The ordinary first-run-of-the-day case. Must not error, and must not
	// clear anything.
	const existing = tab(["2026-09-13", "b", 2]);
	const mutations = resolveWriteOperation(
		existing,
		replaceWhere("Overdue_port", 0, { equals: "2026-09-14" }, [
			["2026-09-14", "new", 1],
		]),
	);
	assert.deepEqual(mutations, [
		{ kind: "append", rows: [["2026-09-14", "new", 1]] },
	]);
});

test("replaceWhere on an empty tab appends", () => {
	const mutations = resolveWriteOperation(
		tab(),
		replaceWhere("TaskDaily_port", 0, { equals: "2026-09-14" }, [
			["2026-09-14", "x", 1],
		]),
	);
	assert.deepEqual(mutations, [
		{ kind: "append", rows: [["2026-09-14", "x", 1]] },
	]);
});

test("replaceWhere with no replacement rows clears and writes nothing", () => {
	// A day that legitimately has zero rows — every habit skipped, say. The
	// stale rows must still go.
	const existing = tab(
		["2026-09-13", "b", 2],
		["2026-09-14", "stale", 9],
	);
	const mutations = resolveWriteOperation(
		existing,
		replaceWhere("TaskDaily_port", 0, { equals: "2026-09-14" }, []),
	);
	assert.deepEqual(mutations, [{ kind: "clearFrom", firstRow: 3 }]);
	assert.deepEqual(
		applyToRows(existing, mutations),
		tab(["2026-09-13", "b", 2]),
	);
});

// ── replaceWhere: onOrAfter (the HabitDaily window) ──────────────────────────

test("replaceWhere onOrAfter rebuilds a trailing window", () => {
	const existing = tab(
		["2026-09-10", "old", 1],
		["2026-09-11", "old", 1],
		["2026-09-12", "in-window", 1],
		["2026-09-13", "in-window", 1],
		["2026-09-14", "in-window", 1],
	);
	const mutations = resolveWriteOperation(
		existing,
		replaceWhere(
			"HabitDaily_port",
			0,
			{ onOrAfter: "2026-09-12" },
			[
				["2026-09-12", "rebuilt", 2],
				["2026-09-13", "rebuilt", 2],
			],
		),
	);

	assert.deepEqual(mutations[0], { kind: "clearFrom", firstRow: 4 });
	const after = applyToRows(existing, mutations);
	assert.deepEqual(
		after,
		tab(
			["2026-09-10", "old", 1],
			["2026-09-11", "old", 1],
			["2026-09-12", "rebuilt", 2],
			["2026-09-13", "rebuilt", 2],
		),
	);
});

// ── replaceWhere: all (the BillCycle full rebuild) ───────────────────────────

test("replaceWhere all rebuilds every data row but keeps the header", () => {
	const existing = tab(["2026-09-12", "a", 1], ["2026-09-13", "b", 2]);
	const mutations = resolveWriteOperation(
		existing,
		replaceWhere("BillCycle_port", 0, { all: true }, [
			["2026-09-14", "rebuilt", 1],
		]),
	);

	assert.deepEqual(mutations, [
		{ kind: "clearFrom", firstRow: 2 },
		{
			kind: "write",
			firstRow: 2,
			rows: [["2026-09-14", "rebuilt", 1]],
		},
	]);
	const after = applyToRows(existing, mutations);
	assert.deepEqual(
		after[0],
		HEADER,
		"the header must survive a full rebuild",
	);
	assert.equal(after.length, 2);
});

// ── the guard that protects unrecoverable tabs ───────────────────────────────

test("replaceWhere refuses when matching rows are not a contiguous tail", () => {
	// A hand-sorted tab. Clearing to the end here would destroy 2026-09-20 —
	// and for TaskDaily or AreaDaily that row cannot be re-fetched from
	// anywhere. Refusing is the whole point.
	const existing = tab(
		["2026-09-14", "today", 1],
		["2026-09-20", "later", 1],
		["2026-09-14", "today", 2],
	);

	assert.throws(
		() =>
			resolveWriteOperation(
				existing,
				replaceWhere(
					"TaskDaily_port",
					0,
					{ equals: "2026-09-14" },
					[["2026-09-14", "new", 1]],
				),
			),
		/contiguous block at the bottom/,
	);
});

// ── upsert ───────────────────────────────────────────────────────────────────

test("upsert replaces a known key in place and appends an unknown one", () => {
	const existing = tab(["2026-09-12", "k", 10], ["2026-09-13", "k", 20]);
	const mutations = resolveWriteOperation(
		existing,
		upsertBy("KarmaStats_port", 0, [
			["2026-09-13", "k", 99], // exists -> in place, at sheet row 3
			["2026-09-14", "k", 5], // new -> appended
		]),
	);

	assert.deepEqual(mutations, [
		{ kind: "write", firstRow: 3, rows: [["2026-09-13", "k", 99]] },
		{ kind: "append", rows: [["2026-09-14", "k", 5]] },
	]);

	const after = applyToRows(existing, mutations);
	assert.deepEqual(
		after,
		tab(
			["2026-09-12", "k", 10],
			["2026-09-13", "k", 99],
			["2026-09-14", "k", 5],
		),
	);
});

test("upsert keeps a row's position rather than moving it to the end", () => {
	// KarmaStats is read as a time series; a row that jumped to the bottom on
	// every update would scramble the order Looker charts.
	const existing = tab(
		["2026-09-12", "k", 1],
		["2026-09-13", "k", 2],
		["2026-09-14", "k", 3],
	);
	const mutations = resolveWriteOperation(
		existing,
		upsertBy("KarmaStats_port", 0, [["2026-09-12", "k", 111]]),
	);
	const after = applyToRows(existing, mutations);
	assert.deepEqual(after[1], ["2026-09-12", "k", 111]);
	assert.equal(after.length, 4);
});

test("upsert updates the first copy when the tab already holds a duplicate key", () => {
	const existing = tab(
		["2026-09-12", "k", 1],
		["2026-09-12", "k", 2], // a pre-existing duplicate
	);
	const mutations = resolveWriteOperation(
		existing,
		upsertBy("KarmaStats_port", 0, [["2026-09-12", "k", 9]]),
	);
	assert.deepEqual(mutations, [
		{ kind: "write", firstRow: 2, rows: [["2026-09-12", "k", 9]] },
	]);
});

test("a Date in the key column is not silently matched against its ISO text", () => {
	// Sheets returns a real Date for a date-formatted cell. cellAsText renders
	// it as a full ISO timestamp, which must not accidentally equal a day key —
	// getting this wrong would make every replaceWhere a no-op and quietly
	// double the rows every night.
	const existing = tab([new Date("2026-09-14T00:00:00Z"), "a", 1]);
	const mutations = resolveWriteOperation(
		existing,
		replaceWhere("Overdue_port", 0, { equals: "2026-09-14" }, [
			["2026-09-14", "new", 1],
		]),
	);
	assert.deepEqual(
		mutations,
		[{ kind: "append", rows: [["2026-09-14", "new", 1]] }],
		"a Date cell must not match a day-key string — C1 owns that conversion",
	);
});
