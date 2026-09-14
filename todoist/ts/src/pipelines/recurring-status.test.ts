// D3 — RecurringStatus, the spine HabitDaily reads.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { TodoistTask } from "../services/todoist/responses.ts";
import {
	buildRecurringStatusRows,
	planRecurringStatus,
	RECURRING_STATUS_HEADER,
} from "./recurring-status.ts";

const TODAY = "2026-09-14";
const TAB = "RecurringStatus_port";

const SNAPSHOT_BASE = {
	projectNamesById: { p1: "Habits", p2: "Work" },
	sectionNamesById: { s1: "Morning" },
};

function rowsFor(tasks: TodoistTask[], today = TODAY) {
	return buildRecurringStatusRows(
		{ ...SNAPSHOT_BASE, recurringTasks: tasks },
		today,
	);
}

const habit: TodoistTask = {
	id: "6cWpJ9",
	content: "Drink Water - early in the morning",
	project_id: "p1",
	section_id: "s1",
	labels: ["habits"],
	priority: 1,
	due: {
		date: "2026-09-15",
		is_recurring: true,
		string: "every day at 6:00 am",
	},
};

test("a row carries every column the tab declares, in order", () => {
	const [row] = rowsFor([habit]);
	assert.ok(row);
	assert.equal(row.length, RECURRING_STATUS_HEADER.length);
	assert.deepEqual(row, [
		"2026-09-14",
		"6cWpJ9",
		"Drink Water - early in the morning",
		"Habits",
		"Morning",
		"habits",
		1,
		"2026-09-15",
		"every day at 6:00 am",
		"",
	]);
});

test("the recurrence string is carried VERBATIM", () => {
	// HabitDaily parses the time of day out of this, and both separators occur
	// in the wild ("at 5:25 am" and "@ 5:25 am"). Normalising here would destroy
	// the evidence the parser needs.
	const rows = rowsFor([
		{
			...habit,
			due: {
				date: "2026-09-15",
				string: "every workday @ 5:25 am",
			},
		},
	]);
	assert.equal(rows[0]?.[8], "every workday @ 5:25 am");
});

test("a task with no section reads as empty, not as a failed lookup", () => {
	// Most tasks have no section. It is not an error.
	const rows = rowsFor([{ ...habit, section_id: null }]);
	assert.equal(rows[0]?.[4], "");
});

test("an unknown section or project resolves to empty rather than an id", () => {
	const rows = rowsFor([
		{ ...habit, project_id: "gone", section_id: "gone" },
	]);
	assert.equal(rows[0]?.[3], "");
	assert.equal(rows[0]?.[4], "");
});

test("a task with no due date still produces a row", () => {
	// It should not happen — a recurring task has a due date by definition — but
	// dropping the row would lose a habit from the spine, and the dense grid
	// would then have no evidence the habit existed that day.
	const rows = rowsFor([{ ...habit, due: null }]);
	assert.equal(rows.length, 1);
	assert.equal(rows[0]?.[7], "");
	assert.equal(rows[0]?.[8], "");
});

test("the plan replaces today's rows so a re-run is idempotent", () => {
	// Without this a manual run after the nightly one doubles every habit's row
	// for the day, and HabitDaily reads the day twice.
	const plan = planRecurringStatus(
		{ ...SNAPSHOT_BASE, recurringTasks: [habit] },
		TAB,
		TODAY,
	);
	assert.equal(plan.writes.length, 1);
	const [write] = plan.writes;
	assert.ok(write && write.mode === "replaceWhere");
	assert.deepEqual(write.match, { equals: TODAY });
	assert.equal(write.columnIndex, 0);
});

test("the plan persists no state", () => {
	const plan = planRecurringStatus(
		{ ...SNAPSHOT_BASE, recurringTasks: [habit] },
		TAB,
		TODAY,
	);
	assert.deepEqual(plan.stateToPersist, {});
});

test("a day with no recurring tasks still clears the day", () => {
	const plan = planRecurringStatus(
		{ ...SNAPSHOT_BASE, recurringTasks: [] },
		TAB,
		TODAY,
	);
	const [write] = plan.writes;
	assert.ok(write && write.mode === "replaceWhere");
	assert.deepEqual(write.rows, []);
});
