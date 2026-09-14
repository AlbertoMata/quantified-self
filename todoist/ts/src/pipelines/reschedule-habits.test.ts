// D11 — the only write path to Todoist. These tests are the safety net: there
// is no shadow Todoist, so nothing else can catch a wrong command.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { TodoistTask } from "../services/todoist/responses.ts";
import {
	dueForDay,
	isStale,
	nextOccurrenceDay,
	planHabitReschedule,
	RESCHEDULE_GRACE_HOURS,
} from "./reschedule-habits.ts";

const TIMEZONE = "America/Mexico_City";
// 2026-09-14 is a Monday. 17:00Z is 11:00 local.
const NOW = new Date("2026-09-14T17:00:00Z");

let uuidCounter = 0;
const newUuid = () => `uuid-${++uuidCounter}`;

function plan(tasks: TodoistTask[], now = NOW) {
	uuidCounter = 0;
	return planHabitReschedule(
		"Morning Routine",
		tasks,
		now,
		TIMEZONE,
		newUuid,
	);
}

// ── staleness ────────────────────────────────────────────────────────────────

test("a task due later today is NOT stale", () => {
	// Comparing dates alone would treat an 8:30 task as "due today" at 6am and
	// bump the whole routine before the day had started.
	const task: TodoistTask = {
		id: "1",
		due: { date: "2026-09-14T20:00:00" },
	};
	assert.equal(isStale(task, NOW, TIMEZONE), false);
});

test("a task only mildly overdue is NOT stale", () => {
	// 09:30 local, two and a half hours before 11:00 — inside the grace window.
	const task: TodoistTask = {
		id: "1",
		due: { date: "2026-09-14T09:30:00" },
	};
	assert.equal(isStale(task, NOW, TIMEZONE), false);
	assert.equal(RESCHEDULE_GRACE_HOURS, 3);
});

test("a task past the grace window IS stale", () => {
	// 07:00 local, four hours before 11:00.
	const task: TodoistTask = {
		id: "1",
		due: { date: "2026-09-14T07:00:00" },
	};
	assert.equal(isStale(task, NOW, TIMEZONE), true);
});

test("a floating datetime is read as LOCAL, not UTC", () => {
	// The trap: parsing "…T07:00:00" as UTC makes it 01:00 local, which in a
	// UTC-6 zone looks six hours MORE stale than it is — bumping a routine that
	// was only just missed. The offset has to be applied explicitly.
	const notYet: TodoistTask = {
		id: "1",
		due: { date: "2026-09-14T09:00:00" },
	};
	assert.equal(
		isStale(notYet, NOW, TIMEZONE),
		false,
		"09:00 local is only 2h before 11:00 local",
	);
});

test("a DATE-ONLY due only goes stale once the day has passed", () => {
	// There is no clock time to be hours behind.
	assert.equal(
		isStale(
			{ id: "1", due: { date: "2026-09-14" } },
			NOW,
			TIMEZONE,
		),
		false,
	);
	assert.equal(
		isStale(
			{ id: "1", due: { date: "2026-09-13" } },
			NOW,
			TIMEZONE,
		),
		true,
	);
});

test("an undated task is never stale", () => {
	// It was never scheduled, so it cannot have been skipped.
	assert.equal(isStale({ id: "1" }, NOW, TIMEZONE), false);
	assert.equal(isStale({ id: "1", due: null }, NOW, TIMEZONE), false);
});

// ── the target day ───────────────────────────────────────────────────────────

test("a workday rule skips the weekend", () => {
	const workday: TodoistTask = {
		id: "1",
		due: {
			date: "2026-09-11T07:00:00",
			string: "every workday at 7am",
		},
	};
	// Friday the 11th → Monday the 14th, not Saturday.
	assert.equal(nextOccurrenceDay(workday, "2026-09-11"), "2026-09-14");
});

test("a daily rule moves one calendar day, weekend or not", () => {
	const daily: TodoistTask = {
		id: "1",
		due: {
			date: "2026-09-11T07:00:00",
			string: "every day at 7am",
		},
	};
	assert.equal(nextOccurrenceDay(daily, "2026-09-11"), "2026-09-12");
});

// ── building the due object ──────────────────────────────────────────────────

test("the time of day survives the move", () => {
	const task: TodoistTask = {
		id: "1",
		due: {
			date: "2026-09-13T07:50:00",
			string: "every day at 7:50am",
		},
	};
	assert.deepEqual(dueForDay(task, "2026-09-15"), {
		string: "every day at 7:50am",
		date: "2026-09-15T07:50:00",
	});
});

test("the RECURRING STRING survives the move", () => {
	// The whole reason this goes through /sync with an item_update. A flat
	// due_string update would re-anchor or drop the recurrence, turning a daily
	// habit into a one-off.
	const task: TodoistTask = {
		id: "1",
		due: {
			date: "2026-09-13T07:50:00",
			string: "every workday at 7:50am",
			is_recurring: true,
		},
	};
	assert.equal(
		dueForDay(task, "2026-09-15").string,
		"every workday at 7:50am",
	);
});

test("a date-only task stays date-only", () => {
	const task: TodoistTask = { id: "1", due: { date: "2026-09-13" } };
	assert.deepEqual(dueForDay(task, "2026-09-15"), { date: "2026-09-15" });
});

// ── the plan ─────────────────────────────────────────────────────────────────

test("nothing stale means no commands at all", () => {
	const result = plan([
		{ id: "1", due: { date: "2026-09-14T20:00:00" } },
	]);
	assert.deepEqual(result.commands, []);
});

test("a habit and its sub-habits move as ONE unit", () => {
	// Judged individually they go stale on different clocks: the parent is
	// bumped once the grace window passes, while its date-only steps are not
	// stale until the day flips — leaving the steps a day behind the routine
	// they belong to, reading as skipped in that night's Overdue snapshot.
	const result = plan([
		{
			id: "parent",
			due: {
				date: "2026-09-14T07:00:00",
				string: "every day at 7am",
			},
		},
		{
			id: "step1",
			parent_id: "parent",
			due: { date: "2026-09-14" },
		},
		{
			id: "step2",
			parent_id: "parent",
			due: { date: "2026-09-14" },
		},
	]);

	assert.equal(result.commands.length, 3);
	for (const command of result.commands) {
		assert.match(String(command.args.due.date), /^2026-09-15/);
	}
});

test("a step keeps its OWN recurrence while landing on the parent's day", () => {
	const result = plan([
		{
			id: "parent",
			due: {
				date: "2026-09-14T07:00:00",
				string: "every day at 7am",
			},
		},
		{
			id: "step",
			parent_id: "parent",
			due: {
				date: "2026-09-14T08:00:00",
				string: "every workday at 8am",
			},
		},
	]);
	const stepCommand = result.commands.find((c) => c.args.id === "step");
	assert.equal(stepCommand?.args.due.string, "every workday at 8am");
	assert.equal(stepCommand?.args.due.date, "2026-09-15T08:00:00");
});

test("an UNDATED step is left alone", () => {
	// It was never scheduled, and giving it a date would silently opt it into
	// the Overdue snapshot.
	const result = plan([
		{
			id: "parent",
			due: {
				date: "2026-09-14T07:00:00",
				string: "every day",
			},
		},
		{ id: "step", parent_id: "parent" },
	]);
	assert.deepEqual(
		result.commands.map((c) => c.args.id),
		["parent"],
	);
});

test("a healthy parent still drags a straggling step forward", () => {
	// Do the routine but leave one box unchecked: Todoist rolls the PARENT
	// forward on completion while the step stays put. The parent is healthy, so
	// nothing else would ever touch that step and it stays overdue for ever.
	const result = plan([
		{
			id: "parent",
			due: {
				date: "2026-09-20T07:00:00",
				string: "every day",
			},
		},
		{
			id: "straggler",
			parent_id: "parent",
			due: { date: "2026-09-10" },
		},
	]);
	assert.deepEqual(
		result.commands.map((c) => c.args.id),
		["straggler"],
	);
	assert.equal(result.commands[0]?.args.due.date, "2026-09-20");
});

test("a step whose parent is outside this section judges itself", () => {
	// Nothing here can judge it, and stranding it on a stale date would be
	// worse than moving it.
	const result = plan([
		{
			id: "orphan",
			parent_id: "elsewhere",
			due: { date: "2026-09-14T07:00:00" },
		},
	]);
	assert.deepEqual(
		result.commands.map((c) => c.args.id),
		["orphan"],
	);
});

test("every command carries its own idempotency uuid", () => {
	// Todoist uses the uuid to make a replay a no-op. A reused one would make
	// the second command silently do nothing, so a batch would half-apply.
	const result = plan([
		{ id: "a", due: { date: "2026-09-14T07:00:00" } },
		{ id: "b", due: { date: "2026-09-14T07:00:00" } },
	]);
	const uuids = result.commands.map((c) => c.uuid);
	assert.equal(new Set(uuids).size, uuids.length);
	for (const command of result.commands) {
		assert.equal(command.type, "item_update");
	}
});

test("the log names every task it would move, before anything is sent", () => {
	// The only rail this pipeline has: reading what a run WOULD do is always
	// possible without doing it.
	const result = plan([
		{ id: "a", due: { date: "2026-09-14T07:00:00" } },
	]);
	assert.ok(
		result.logLines.some((line) => line.includes("a → 2026-09-15")),
	);
	assert.ok(result.logLines[0]?.includes("America/Mexico_City"));
});
