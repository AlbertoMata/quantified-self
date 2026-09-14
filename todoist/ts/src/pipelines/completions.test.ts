// D5 — Completions. The tab whose rows cannot be re-fetched, so these are the
// tests that matter most in Phase D.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { AreaMap, ProjectTree } from "../core/areas.ts";
import type { Row } from "../ports/values.ts";
import {
	buildCompletionRow,
	COMPLETIONS_HEADER,
	newlyInReview,
	parseInReviewIds,
	planCompletions,
	PORT_IN_REVIEW_PREV_KEY,
	PORT_LAST_SYNC_KEY,
	type CompletionEvent,
	type CompletionsSnapshot,
} from "./completions.ts";

const SYNCED_ON = "2026-09-14";
const UNTIL = new Date("2026-09-15T05:30:00Z");
const TAB = "Completions_port";

const AREA_MAP: AreaMap = {
	byParentId: { "work-parent": "work" },
	byProjectId: { habits: "habits" },
	order: ["bills-taxes", "work", "habits", "errands"],
	weekProjectId: "week",
};

const TREE: ProjectTree = {
	p1: { name: "Habits", parentId: "" },
	habits: { name: "Habits", parentId: "" },
};

function snapshotWith(
	overrides: Partial<CompletionsSnapshot> = {},
): CompletionsSnapshot {
	return {
		oneOffCompletions: [],
		recurringCompletions: [],
		inReviewTasks: [],
		previousInReviewIds: new Set<string>(),
		existingRows: [COMPLETIONS_HEADER],
		projectNamesById: { p1: "Habits", habits: "Habits" },
		sectionNamesById: { s1: "In Review" },
		projectTree: TREE,
		areaMap: AREA_MAP,
		...overrides,
	};
}

const completion: CompletionEvent = {
	id: "6cWpJ9",
	completed_at: "2026-09-14T13:02:00Z",
	content: "Drink Water",
	project_id: "habits",
	labels: ["habits", "5"],
	priority: 1,
	due: { date: "2026-09-15", is_recurring: true },
};

function writeRows(plan: { writes: readonly { mode: string }[] }): Row[] {
	const [write] = plan.writes;
	assert.ok(write && write.mode === "append");
	return (write as unknown as { rows: Row[] }).rows;
}

// ── the row ──────────────────────────────────────────────────────────────────

test("a row carries all seventeen columns in order", () => {
	const row = buildCompletionRow(
		completion,
		snapshotWith(),
		SYNCED_ON,
		UNTIL.toISOString(),
	);
	assert.equal(row.length, COMPLETIONS_HEADER.length);
	assert.equal(row[0], "2026-09-14T13:02:00Z");
	assert.equal(row[1], "6cWpJ9");
	assert.equal(row[8], "TRUE", "is_recurring");
	assert.equal(row[11], SYNCED_ON, "synced_on is the LOCAL day");
	assert.equal(row[13], 5, "complexity, from the numeric label");
	assert.equal(row[14], "habits", "area");
	assert.equal(row[15], "project", "area_source");
});

test("was_overdue is blank when unknown, never FALSE", () => {
	// Only recurring activity events carry it, and "unknown" must not read as
	// "closed on time" — BillCycle trusts this field over its own date maths.
	const unknown = buildCompletionRow(
		completion,
		snapshotWith(),
		SYNCED_ON,
		"",
	);
	assert.equal(unknown[16], "");

	const late = buildCompletionRow(
		{ ...completion, was_overdue: true },
		snapshotWith(),
		SYNCED_ON,
		"",
	);
	assert.equal(late[16], "TRUE");

	const onTime = buildCompletionRow(
		{ ...completion, was_overdue: false },
		snapshotWith(),
		SYNCED_ON,
		"",
	);
	assert.equal(onTime[16], "FALSE");
});

test("an event with no completed_at falls back to the window end", () => {
	const row = buildCompletionRow(
		{ id: "1", project_id: "p1" },
		snapshotWith(),
		SYNCED_ON,
		UNTIL.toISOString(),
	);
	assert.equal(row[0], UNTIL.toISOString());
});

test("the area is captured at write time, from labels then the tree", () => {
	// Labels are FROZEN into the row here, which is exactly why historical rows
	// must be re-derived from project_id rather than re-read.
	const labelled = buildCompletionRow(
		{ ...completion, project_id: "p1", labels: ["area-work"] },
		snapshotWith(),
		SYNCED_ON,
		"",
	);
	assert.equal(labelled[14], "work");
	assert.equal(labelled[15], "label");
});

// ── the In Review diff ───────────────────────────────────────────────────────

test("only tasks that ENTERED In Review count", () => {
	// It is a STATE, not an event. Counting everything currently there would
	// re-record the same task every night until it moved out.
	const snapshot = snapshotWith({
		inReviewTasks: [{ id: "a" }, { id: "b" }, { id: "c" }],
		previousInReviewIds: new Set(["a", "b"]),
	});
	assert.deepEqual(
		newlyInReview(snapshot).map((task) => task.id),
		["c"],
	);
});

test("a task that leaves and re-enters is recorded again", () => {
	const snapshot = snapshotWith({
		inReviewTasks: [{ id: "a" }],
		previousInReviewIds: new Set(["b"]), // 'a' left, then came back
	});
	assert.deepEqual(
		newlyInReview(snapshot).map((task) => task.id),
		["a"],
	);
});

test("the first ever run treats everything in review as new", () => {
	// A one-time backfill, and the honest default: an over-count is visible and
	// removable, an under-count is neither.
	const snapshot = snapshotWith({
		inReviewTasks: [{ id: "a" }, { id: "b" }],
		previousInReviewIds: new Set(),
	});
	assert.equal(newlyInReview(snapshot).length, 2);
});

// ── dedup ────────────────────────────────────────────────────────────────────

test("a completion already in the tab is not appended again", () => {
	const existing: Row[] = [
		COMPLETIONS_HEADER,
		["2026-09-14T13:02:00Z", "6cWpJ9", ...Array(15).fill("")],
	];
	const plan = planCompletions(
		snapshotWith({
			oneOffCompletions: [completion],
			existingRows: existing,
		}),
		TAB,
		SYNCED_ON,
		UNTIL,
	);
	assert.deepEqual(writeRows(plan), []);
});

test("the SAME task completed twice produces two rows", () => {
	// THE bug the composite key exists to prevent. A recurring task reuses its
	// task_id every time; deduping on id alone would keep the first check-off of
	// a habit and discard every one after it.
	const monday = { ...completion, completed_at: "2026-09-14T07:02:00Z" };
	const tuesday = { ...completion, completed_at: "2026-09-15T07:11:00Z" };
	const plan = planCompletions(
		snapshotWith({ recurringCompletions: [monday, tuesday] }),
		TAB,
		SYNCED_ON,
		UNTIL,
	);
	assert.equal(writeRows(plan).length, 2);
});

test("a task in BOTH a one-off completion and In Review appends once", () => {
	// The sources are disjoint by construction for 1 and 2, but the In Review
	// snapshot is not — so the run also dedups against itself.
	const plan = planCompletions(
		snapshotWith({
			oneOffCompletions: [completion],
			inReviewTasks: [completion],
			previousInReviewIds: new Set(),
		}),
		TAB,
		SYNCED_ON,
		UNTIL,
	);
	assert.equal(writeRows(plan).length, 1);
});

test("an event with no task id is dropped, and said so", () => {
	// Without an id it can never be deduped, so it would re-append every night.
	const plan = planCompletions(
		snapshotWith({
			oneOffCompletions: [
				{ completed_at: "2026-09-14T13:02:00Z" },
			],
		}),
		TAB,
		SYNCED_ON,
		UNTIL,
	);
	assert.deepEqual(writeRows(plan), []);
	assert.ok(plan.logLines.some((line) => line.includes("no task id")));
});

test("a Date cell in the tab still dedups against a string event", () => {
	// Sheets hands back column A as a Date once the column is date-formatted.
	const iso = "2026-09-14T13:02:00.000Z";
	const existing: Row[] = [
		COMPLETIONS_HEADER,
		[new Date(iso), "6cWpJ9", ...Array(15).fill("")],
	];
	const plan = planCompletions(
		snapshotWith({
			oneOffCompletions: [
				{ ...completion, completed_at: iso },
			],
			existingRows: existing,
		}),
		TAB,
		SYNCED_ON,
		UNTIL,
	);
	assert.deepEqual(
		writeRows(plan),
		[],
		"a Date-typed completed_at must match the same instant as a string",
	);
});

// ── the plan ─────────────────────────────────────────────────────────────────

test("the plan only ever appends", () => {
	// This tab must never replace or clear: its rows are history that cannot be
	// re-fetched once Todoist's ~12-month retention passes.
	const plan = planCompletions(
		snapshotWith({ oneOffCompletions: [completion] }),
		TAB,
		SYNCED_ON,
		UNTIL,
	);
	assert.equal(plan.writes.length, 1);
	assert.equal(plan.writes[0]?.mode, "append");
});

test("both state keys are PORT_-prefixed", () => {
	// The store is shared with the running legacy sync. Writing the unprefixed
	// names would advance its cursor and make the nightly run skip a window —
	// losing rows in a tab the port never wrote.
	const plan = planCompletions(
		snapshotWith({ inReviewTasks: [{ id: "a" }] }),
		TAB,
		SYNCED_ON,
		UNTIL,
	);
	for (const key of Object.keys(plan.stateToPersist)) {
		assert.match(key, /^PORT_/);
	}
	assert.equal(
		plan.stateToPersist[PORT_LAST_SYNC_KEY],
		UNTIL.toISOString(),
	);
	assert.equal(plan.stateToPersist[PORT_IN_REVIEW_PREV_KEY], '["a"]');
});

test("the In Review baseline records EVERYTHING there, not just the new ones", () => {
	// Persisting only the new ones would make every unchanged task look new on
	// the following run, and re-record it every night for ever.
	const plan = planCompletions(
		snapshotWith({
			inReviewTasks: [{ id: "a" }, { id: "b" }],
			previousInReviewIds: new Set(["a"]),
		}),
		TAB,
		SYNCED_ON,
		UNTIL,
	);
	assert.equal(plan.stateToPersist[PORT_IN_REVIEW_PREV_KEY], '["a","b"]');
});

test("a run with nothing new still advances the cursor", () => {
	// Otherwise the window grows without bound and eventually exceeds the API's
	// 3-month span limit.
	const plan = planCompletions(snapshotWith(), TAB, SYNCED_ON, UNTIL);
	assert.equal(
		plan.stateToPersist[PORT_LAST_SYNC_KEY],
		UNTIL.toISOString(),
	);
});

// ── reading the state back ───────────────────────────────────────────────────

test("absent or malformed state reads as an empty set", () => {
	// Which makes the next run treat everything in review as new — a one-time
	// over-count rather than a silent under-count. A duplicate row is visible
	// and removable; a missing one is neither.
	assert.equal(parseInReviewIds(null).size, 0);
	assert.equal(parseInReviewIds("").size, 0);
	assert.equal(parseInReviewIds("not json").size, 0);
	assert.equal(parseInReviewIds('{"not":"an array"}').size, 0);
});

test("persisted ids round-trip", () => {
	const plan = planCompletions(
		snapshotWith({ inReviewTasks: [{ id: "a" }, { id: 42 }] }),
		TAB,
		SYNCED_ON,
		UNTIL,
	);
	const restored = parseInReviewIds(
		plan.stateToPersist[PORT_IN_REVIEW_PREV_KEY] ?? null,
	);
	assert.deepEqual([...restored], ["a", "42"]);
});
