// C3 — the habit verdict and streak. The scratchpad harness, committed.

import assert from "node:assert/strict";
import { test } from "node:test";

import { addDaysToDay } from "./dates.ts";
import {
	clockTimeOf,
	dueTimeOf,
	habitDayStatus,
	habitDueTime,
	isRestDay,
	nextStreak,
	type HabitDayStatus,
} from "./habits.ts";

const MEXICO_CITY = "America/Mexico_City";

// 2026-09-12 is a Saturday, 13 a Sunday, 14 a Monday.
const SATURDAY = "2026-09-12";
const SUNDAY = "2026-09-13";
const MONDAY = "2026-09-14";

// ── rest days ────────────────────────────────────────────────────────────────

test("weekends are rest days, weekdays are not", () => {
	assert.equal(isRestDay(SATURDAY), true);
	assert.equal(isRestDay(SUNDAY), true);
	assert.equal(isRestDay(MONDAY), false);
	assert.equal(isRestDay("2026-09-18"), false); // Friday
});

test("a rest day is read in UTC, not through a local zone", () => {
	// The trap the legacy comment records: "2026-08-15" parses as UTC midnight,
	// so reading its weekday through a UTC-behind zone reports every Saturday as
	// a Friday — and every weekend would score as missed.
	assert.equal(isRestDay("2026-08-15"), true, "2026-08-15 is a Saturday");
	assert.equal(isRestDay("2026-08-16"), true, "and the 16th a Sunday");
	assert.equal(isRestDay("2026-08-14"), false);
});

// ── the verdict ──────────────────────────────────────────────────────────────

test("a completed habit is done, whatever the day", () => {
	assert.equal(habitDayStatus(MONDAY, true, MONDAY), "done");
	assert.equal(habitDayStatus("2026-09-10", true, MONDAY), "done");
});

test("a weekend check-off still counts as done", () => {
	// Order matters: wasCompleted is tested BEFORE isRestDay. Doing a habit on a
	// rest day is not nothing, and checking the rest day first would discard it.
	assert.equal(habitDayStatus(SATURDAY, true, MONDAY), "done");
	assert.equal(habitDayStatus(SUNDAY, true, MONDAY), "done");
});

test("today is pending, not missed", () => {
	// THE case this exists for. The nightly snapshot writes today's spine rows
	// at 23:30; without pending, every not-yet-done habit would score as missed
	// the moment it appeared — and a manual backfill at noon would do it for the
	// whole day.
	assert.equal(habitDayStatus(MONDAY, false, MONDAY), "pending");
});

test("a past weekday with nothing recorded is missed", () => {
	assert.equal(habitDayStatus("2026-09-10", false, MONDAY), "missed");
});

test("a past weekend with nothing recorded is not a miss", () => {
	assert.equal(habitDayStatus(SATURDAY, false, MONDAY), "not_due");
	assert.equal(habitDayStatus(SUNDAY, false, MONDAY), "not_due");
});

test("a future day cannot be a miss", () => {
	assert.equal(habitDayStatus("2026-09-20", false, MONDAY), "not_due");
	assert.equal(habitDayStatus("2027-01-01", false, MONDAY), "not_due");
});

// ── streaks ──────────────────────────────────────────────────────────────────

test("done increments and missed resets", () => {
	assert.equal(nextStreak(4, "done"), 5);
	assert.equal(nextStreak(4, "missed"), 0);
});

test("pending and not_due carry the streak rather than breaking it", () => {
	// A weekend, a future day and the day still in progress are not failures.
	assert.equal(nextStreak(4, "pending"), 4);
	assert.equal(nextStreak(4, "not_due"), 4);
	assert.equal(nextStreak(0, "not_due"), 0);
});

test("a weekend does not break a weekday streak", () => {
	// The property that makes the whole rule worth having: Friday done, weekend
	// off, Monday done should read as three, not one.
	let streak = 0;
	const days: Array<[string, boolean]> = [
		["2026-09-11", true], // Friday, done
		[SATURDAY, false], // rest
		[SUNDAY, false], // rest
		[MONDAY, true], // Monday, done
	];
	for (const [day, completed] of days) {
		streak = nextStreak(
			streak,
			habitDayStatus(day, completed, MONDAY),
		);
	}
	assert.equal(
		streak,
		2,
		"two done days, with the weekend carried across",
	);
});

test("one missed weekday resets the streak to zero", () => {
	let streak = 10;
	streak = nextStreak(
		streak,
		habitDayStatus("2026-09-10", false, MONDAY),
	);
	assert.equal(streak, 0);
	streak = nextStreak(streak, habitDayStatus("2026-09-11", true, MONDAY));
	assert.equal(streak, 1, "and starts again from the next done day");
});

test("a streak over a full window stays consistent", () => {
	// Walk 30 days of weekday-only completions and assert the arithmetic holds
	// end to end, the way the grid builder runs it.
	let streak = 0;
	let doneDays = 0;
	let day = addDaysToDay(MONDAY, -29);
	const statuses: HabitDayStatus[] = [];

	for (let index = 0; index < 30; index += 1) {
		const completed = !isRestDay(day);
		const status = habitDayStatus(day, completed, MONDAY);
		statuses.push(status);
		if (status === "done") doneDays += 1;
		streak = nextStreak(streak, status);
		day = addDaysToDay(day, 1);
	}

	assert.equal(statuses.includes("missed"), false, "nothing was missed");
	assert.equal(
		streak,
		doneDays,
		"every done day counted, weekends carried",
	);
});

// ── due times ────────────────────────────────────────────────────────────────

test("a recurrence time is parsed to 24h", () => {
	assert.equal(dueTimeOf("every workday at 8:30 pm"), "20:30");
	assert.equal(dueTimeOf("every day at 6 am"), "06:00");
	assert.equal(dueTimeOf("every day at 14:05"), "14:05");
});

test("both separators are matched — the bug that blanked five habits", () => {
	// Todoist echoes a rule back with whatever separator it was typed with, so
	// these are the same rule stored two ways. Matching only "at" silently
	// blanked due_time for five real habits.
	assert.equal(dueTimeOf("every workday at 5:25 am"), "05:25");
	assert.equal(dueTimeOf("every workday @ 5:25 am"), "05:25");
});

test("the 'at' inside a weekday name never matches", () => {
	// Why \bat\b carries a boundary on BOTH sides — "Saturday" contains "at".
	assert.equal(dueTimeOf("every Saturday"), "");
	assert.equal(dueTimeOf("every Saturday at 9 am"), "09:00");
});

test("midnight and noon are handled the way people mean them", () => {
	assert.equal(dueTimeOf("every day at 12:30 am"), "00:30");
	assert.equal(dueTimeOf("every day at 12:30 pm"), "12:30");
	assert.equal(dueTimeOf("every day at 12 am"), "00:00");
});

test("a rule with no time yields no time", () => {
	assert.equal(dueTimeOf("every workday"), "");
	assert.equal(dueTimeOf(""), "");
	assert.equal(dueTimeOf(null), "");
});

test("a nonsense time is rejected rather than wrapped around", () => {
	assert.equal(dueTimeOf("every day at 99:99"), "");
});

// ── clock times off a due date ───────────────────────────────────────────────

test("a floating datetime string is read digit-wise, never through Date", () => {
	// Constructing a Date from a bare day would parse it as UTC midnight and, in
	// a UTC-behind zone, report 18:00 the day before.
	assert.equal(clockTimeOf("2026-08-17T05:10:00", MEXICO_CITY), "05:10");
	assert.equal(
		clockTimeOf("2026-09-07", MEXICO_CITY),
		"",
		"an all-day date carries no time",
	);
});

test("an all-day cell stored as midnight reads as no time", () => {
	// A habit due at exactly 00:00 is not a thing.
	const midnightLocal = new Date("2026-09-14T06:00:00Z"); // 00:00 in Mexico City
	assert.equal(clockTimeOf(midnightLocal, MEXICO_CITY), "");
});

test("a Date cell is formatted in the given zone", () => {
	const instant = new Date("2026-09-14T02:30:00Z"); // 20:30 on the 13th, local
	assert.equal(clockTimeOf(instant, MEXICO_CITY), "20:30");
	assert.equal(clockTimeOf(instant, "UTC"), "02:30");
});

test("the recurrence rule wins over the due date", () => {
	// The rule is what the author wrote; the due date is what Todoist computed.
	assert.equal(
		habitDueTime(
			"every workday at 8:30 pm",
			"2026-09-14T05:10:00",
			MEXICO_CITY,
		),
		"20:30",
	);
});

test("the due date is the fallback when the rule carries no time", () => {
	// "Wash your face" is due at 20:30 every workday, but its rule reads plainly
	// "every workday" — so without this fallback its due_time would be blank.
	assert.equal(
		habitDueTime(
			"every workday",
			"2026-09-14T20:30:00",
			MEXICO_CITY,
		),
		"20:30",
	);
	assert.equal(
		habitDueTime("every workday", "2026-09-14", MEXICO_CITY),
		"",
	);
});
