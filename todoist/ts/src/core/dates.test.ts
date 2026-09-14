import assert from "node:assert/strict";
import { test } from "node:test";

import {
	addDaysToDay,
	cellValueToDayKey,
	cellValueToLocalDay,
	daysBetweenDays,
	formatDayInTimezone,
	formatTodoistDateTime,
	formatUtcDay,
	isValidDayKey,
} from "./dates.ts";

const MEXICO_CITY = "America/Mexico_City";

// ── the bug this module exists to prevent ────────────────────────────────────

test("an evening instant is yesterday in UTC and today locally", () => {
	// The 2026-08-20 seam recorded in todoist/history.md. At 20:00 in a UTC-6
	// zone the UTC date has already rolled over, so formatting via toISOString
	// files the event on TOMORROW — landing rescheduled tasks a day late and
	// evening habit completions on the wrong day.
	const eveningInMexicoCity = new Date("2026-08-21T02:00:00Z"); // 20:00 on the 20th

	assert.equal(formatUtcDay(eveningInMexicoCity), "2026-08-21");
	assert.equal(
		formatDayInTimezone(eveningInMexicoCity, MEXICO_CITY),
		"2026-08-20",
		"the local day is what a human would call it, and what the sheet must record",
	);
});

test("the two formatters agree during local daytime", () => {
	// Which is exactly why the bug survived so long: it is only ever visible in
	// the evening, and the nightly run is at 23:30.
	const middayInMexicoCity = new Date("2026-08-20T18:00:00Z"); // 12:00 local
	assert.equal(formatUtcDay(middayInMexicoCity), "2026-08-20");
	assert.equal(
		formatDayInTimezone(middayInMexicoCity, MEXICO_CITY),
		"2026-08-20",
	);
});

test("the 23:30 nightly run is the case that matters most", () => {
	// It finalises the day, so getting its day wrong writes every row under the
	// following date.
	const nightlyRun = new Date("2026-09-15T05:30:00Z"); // 23:30 on the 14th
	assert.equal(
		formatDayInTimezone(nightlyRun, MEXICO_CITY),
		"2026-09-14",
		"the run that finalises the 14th must file under the 14th",
	);
	assert.equal(formatUtcDay(nightlyRun), "2026-09-15");
});

test("the timezone is an argument, so another zone gives another day", () => {
	// The property that makes a GitHub runner possible: nothing here reads an
	// ambient zone, so the same instant formats correctly for any of them.
	const instant = new Date("2026-08-21T02:00:00Z");
	assert.equal(formatDayInTimezone(instant, "UTC"), "2026-08-21");
	assert.equal(formatDayInTimezone(instant, MEXICO_CITY), "2026-08-20");
	assert.equal(formatDayInTimezone(instant, "Asia/Tokyo"), "2026-08-21");
});

// ── formatting ───────────────────────────────────────────────────────────────

test("an invalid date formats as empty, not as 'Invalid Date'", () => {
	assert.equal(formatUtcDay(new Date("nonsense")), "");
	assert.equal(
		formatDayInTimezone(new Date("nonsense"), MEXICO_CITY),
		"",
	);
});

test("Todoist datetimes carry no milliseconds and no trailing Z", () => {
	// The API rejects the ISO form with either.
	assert.equal(
		formatTodoistDateTime(new Date("2026-09-14T05:30:00.123Z")),
		"2026-09-14T05:30:00",
	);
});

// ── reading cells ────────────────────────────────────────────────────────────

test("a Date cell and a string cell produce the same key", () => {
	// Sheets returns a real Date once a cell is date-formatted, so a raw ===
	// against "2026-05-26" silently misses. This is what stops that.
	assert.equal(
		cellValueToDayKey(new Date("2026-05-26T00:00:00Z")),
		"2026-05-26",
	);
	assert.equal(cellValueToDayKey("2026-05-26"), "2026-05-26");
});

test("an empty cell reads as an empty key rather than throwing", () => {
	assert.equal(cellValueToDayKey(null), "");
	assert.equal(cellValueToDayKey(undefined), "");
	assert.equal(cellValueToDayKey(""), "");
});

test("a stored UTC timestamp reads back as its local day", () => {
	// The legacy localDayOf, with the ambient zone made explicit. An event at
	// 20:00 local carries the following UTC date.
	assert.equal(
		cellValueToLocalDay("2026-08-21T02:00:00Z", MEXICO_CITY),
		"2026-08-20",
	);
	assert.equal(
		cellValueToLocalDay(
			new Date("2026-08-21T02:00:00Z"),
			MEXICO_CITY,
		),
		"2026-08-20",
	);
});

test("unparseable cell values read as empty, not as NaN", () => {
	assert.equal(cellValueToLocalDay("not a date", MEXICO_CITY), "");
	assert.equal(cellValueToLocalDay("", MEXICO_CITY), "");
});

// ── arithmetic ───────────────────────────────────────────────────────────────

test("days between two days is signed", () => {
	assert.equal(daysBetweenDays("2026-09-10", "2026-09-14"), 4);
	assert.equal(daysBetweenDays("2026-09-14", "2026-09-10"), -4);
	assert.equal(daysBetweenDays("2026-09-14", "2026-09-14"), 0);
});

test("a floating due datetime works as well as a plain day", () => {
	assert.equal(daysBetweenDays("2026-09-15T11:00:00", "2026-09-17"), 2);
});

test("a missing end returns null rather than NaN", () => {
	// A blank due date must propagate as a blank cell, not poison a sum.
	assert.equal(daysBetweenDays("", "2026-09-14"), null);
	assert.equal(daysBetweenDays("2026-09-14", null), null);
	assert.equal(daysBetweenDays("nonsense", "2026-09-14"), null);
});

test("a span crossing a DST change is still exact", () => {
	// Anchoring both ends to UTC midnight is what guarantees this. Subtracting
	// two local Dates across a clock change gives 23 or 25 hours and rounds to
	// the wrong day. The US switched on 2026-03-08; Mexico no longer does, so
	// this guards against a zone changing its mind rather than today's calendar.
	assert.equal(daysBetweenDays("2026-03-07", "2026-03-09"), 2);
	assert.equal(daysBetweenDays("2026-11-01", "2026-11-02"), 1);
});

test("a span across a year boundary is exact", () => {
	assert.equal(daysBetweenDays("2026-12-30", "2027-01-02"), 3);
});

test("adding days rolls over months and years, and steps backwards", () => {
	assert.equal(addDaysToDay("2026-09-14", 1), "2026-09-15");
	assert.equal(addDaysToDay("2026-09-30", 1), "2026-10-01");
	assert.equal(addDaysToDay("2026-12-31", 1), "2027-01-01");
	assert.equal(addDaysToDay("2026-01-01", -1), "2025-12-31");
	assert.equal(addDaysToDay("2026-09-14", 0), "2026-09-14");
});

test("adding days handles a leap year", () => {
	assert.equal(addDaysToDay("2028-02-28", 1), "2028-02-29");
	assert.equal(addDaysToDay("2026-02-28", 1), "2026-03-01");
});

test("a habit window of 30 days round-trips", () => {
	// HabitDaily rebuilds a trailing window, so the two must be inverses or the
	// window silently shifts every night.
	const cutoff = addDaysToDay("2026-09-14", -29);
	assert.equal(cutoff, "2026-08-16");
	assert.equal(daysBetweenDays(cutoff, "2026-09-14"), 29);
});

// ── validation ───────────────────────────────────────────────────────────────

test("a day key is validated by value, not just by shape", () => {
	// "2026-02-30" matches the pattern and is not a date. Dates arrive from
	// cells people can type into.
	assert.equal(isValidDayKey("2026-09-14"), true);
	assert.equal(isValidDayKey("2026-02-30"), false);
	assert.equal(isValidDayKey("2026-13-01"), false);
	assert.equal(isValidDayKey("14-09-2026"), false);
	assert.equal(isValidDayKey(""), false);
});
