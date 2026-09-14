// D2 — Overdue. The parity checklist is todoist/schema/overdue.md.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { TodoistTask } from "../services/todoist/responses.ts";
import { buildOverdueRows, OVERDUE_HEADER, planOverdue } from "./overdue.ts";

const TODAY = "2026-09-14";
const TAB = "Overdue_port";

const PROJECTS = { "220474322": "Work", "220474323": "Errands" };

function task(overrides: Partial<TodoistTask> = {}): TodoistTask {
	return {
		id: "8284945872",
		content: "Review weekly goals",
		project_id: "220474322",
		labels: ["habit"],
		priority: 3,
		due: { date: "2026-09-12", is_recurring: false },
		...overrides,
	};
}

function rowsFor(tasks: TodoistTask[], today = TODAY) {
	return buildOverdueRows(
		{ overdueTasks: tasks, projectNamesById: PROJECTS },
		today,
	);
}

test("a row carries every column the schema declares, in order", () => {
	const [row] = rowsFor([task()]);
	assert.ok(row);
	assert.equal(row.length, OVERDUE_HEADER.length);
	assert.deepEqual(row, [
		"2026-09-14",
		"8284945872",
		"Review weekly goals",
		"Work",
		"habit",
		"2026-09-12",
		2,
		3,
		"FALSE",
		"",
	]);
});

test("days_overdue is snapshot_date minus due_date", () => {
	assert.equal(
		rowsFor([task({ due: { date: "2026-09-13" } })])[0]?.[6],
		1,
	);
	assert.equal(
		rowsFor([task({ due: { date: "2026-09-01" } })])[0]?.[6],
		13,
	);
	assert.equal(rowsFor([task({ due: { date: TODAY } })])[0]?.[6], 0);
});

test("the snapshot day is the LOCAL day, and it is passed in", () => {
	// The bug the legacy comment records: the trigger fires 23:30 in Mexico
	// City, which is already tomorrow in UTC, so a UTC stamp labelled every
	// nightly snapshot with the NEXT day — and inflated days_overdue by one for
	// months. Taking `today` as an argument is what makes that untestable-by-
	// accident case testable on purpose.
	const rows = rowsFor(
		[task({ due: { date: "2026-09-12" } })],
		"2026-09-14",
	);
	assert.equal(rows[0]?.[0], "2026-09-14");
	assert.equal(rows[0]?.[6], 2);

	const offByOne = rowsFor(
		[task({ due: { date: "2026-09-12" } })],
		"2026-09-15",
	);
	assert.equal(
		offByOne[0]?.[6],
		3,
		"a day's drift shows up directly in the number",
	);
});

test("a task with no due date reads as zero days overdue, not as a guess", () => {
	const rows = rowsFor([task({ due: null })]);
	assert.equal(rows[0]?.[5], "");
	assert.equal(rows[0]?.[6], 0);
});

test("an unknown project resolves to empty rather than to an id", () => {
	// A project deleted between the task being written and the snapshot being
	// taken. An id leaking into a name column would read as a project called
	// "6hRq7W9rfWC9x8R9" in Looker.
	const rows = rowsFor([task({ project_id: "not-in-the-map" })]);
	assert.equal(rows[0]?.[3], "");
});

test("labels join with commas and an absent list is empty", () => {
	// The API OMITS an empty list rather than sending []. exactOptionalPropertyTypes
	// makes that distinction real in the type, so the test omits the key too
	// rather than passing an explicit undefined.
	assert.equal(rowsFor([task({ labels: ["a", "b"] })])[0]?.[4], "a,b");
	assert.equal(
		rowsFor([{ id: "1", project_id: "220474322" }])[0]?.[4],
		"",
	);
});

test("priority defaults to 1, because Todoist omits it", () => {
	assert.equal(
		rowsFor([{ id: "1", project_id: "220474322" }])[0]?.[7],
		1,
	);
	assert.equal(rowsFor([task({ priority: 4 })])[0]?.[7], 4);
});

test("is_recurring is the string TRUE/FALSE the schema declares", () => {
	assert.equal(
		rowsFor([
			task({
				due: { date: "2026-09-12", is_recurring: true },
			}),
		])[0]?.[8],
		"TRUE",
	);
	assert.equal(
		rowsFor([task({ due: { date: "2026-09-12" } })])[0]?.[8],
		"FALSE",
	);
});

test("parent_id is carried as the self-blend key, blank for top-level tasks", () => {
	assert.equal(
		rowsFor([task({ parent_id: "8284123456" })])[0]?.[9],
		"8284123456",
	);
	assert.equal(rowsFor([task({ parent_id: null })])[0]?.[9], "");
});

test("a numeric id from the API becomes a string", () => {
	// Sheets would otherwise store it as a number and lose precision on a long
	// id — and a self-blend against a string task_id would never match.
	assert.equal(rowsFor([task({ id: 8284945872 })])[0]?.[1], "8284945872");
});

// ── the plan ─────────────────────────────────────────────────────────────────

test("the plan replaces today's rows and nothing else", () => {
	const plan = planOverdue(
		{ overdueTasks: [task()], projectNamesById: PROJECTS },
		TAB,
		TODAY,
	);
	assert.equal(plan.writes.length, 1);
	const [write] = plan.writes;
	assert.ok(write && write.mode === "replaceWhere");
	assert.equal(write.tab, TAB);
	assert.equal(write.columnIndex, 0);
	assert.deepEqual(write.match, { equals: TODAY });
});

test("a day with nothing overdue still clears that day's stale rows", () => {
	// The case a naive "skip when empty" would get wrong: yesterday's snapshot
	// would be left looking like today's, and a re-run after clearing the last
	// overdue task would show it still overdue.
	const plan = planOverdue(
		{ overdueTasks: [], projectNamesById: PROJECTS },
		TAB,
		TODAY,
	);
	assert.equal(plan.writes.length, 1);
	const [write] = plan.writes;
	assert.ok(write && write.mode === "replaceWhere");
	assert.deepEqual(write.rows, []);
});

test("the plan persists no state, because Overdue keeps no cursor", () => {
	// Which is exactly why it is the safest pipeline to port first: nothing it
	// does can affect the legacy sync's position in Completions.
	const plan = planOverdue(
		{ overdueTasks: [task()], projectNamesById: PROJECTS },
		TAB,
		TODAY,
	);
	assert.deepEqual(plan.stateToPersist, {});
});

test("the plan says what it did", () => {
	const plan = planOverdue(
		{
			overdueTasks: [task(), task({ id: "2" })],
			projectNamesById: PROJECTS,
		},
		TAB,
		TODAY,
	);
	assert.deepEqual(plan.logLines, [
		"Overdue: 2 task(s) overdue on 2026-09-14",
	]);
});

test("planning is pure — the same snapshot gives the same plan", () => {
	const snapshot = { overdueTasks: [task()], projectNamesById: PROJECTS };
	assert.deepEqual(
		planOverdue(snapshot, TAB, TODAY),
		planOverdue(snapshot, TAB, TODAY),
	);
});
