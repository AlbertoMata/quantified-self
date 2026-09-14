// D4 — KarmaStats, the first tab that upserts.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Row } from "../ports/values.ts";
import {
	KARMA_STATS_HEADER,
	planKarmaStats,
	readDailyStreak,
	readDayTotals,
	readKarma,
	readPreviousKarma,
	type TodoistStats,
} from "./karma-stats.ts";

const TODAY = "2026-09-14";
const TAB = "KarmaStats_port";

const STATS: TodoistStats = {
	karma: 14500,
	days_items: [
		{ date: "2026-09-14", total_completed: 12, total_added: 7 },
		{ date: "2026-09-13", total_completed: 9, total_added: 4 },
	],
	goals: { current_daily_streak: { count: 31 } },
};

// ── defensive parsing, which is evidence not habit ───────────────────────────

test("karma is read from either payload shape", () => {
	// The stats payload moved between Sync v9 and v1; the legacy code carries
	// both paths because it was hit by the move.
	assert.equal(readKarma({ karma: 100 }), 100);
	assert.equal(readKarma({ user: { karma: 200 } }), 200);
	assert.equal(readKarma({}), 0);
});

test("the daily streak is read from either shape", () => {
	assert.equal(
		readDailyStreak({
			goals: { current_daily_streak: { count: 5 } },
		}),
		5,
	);
	assert.equal(readDailyStreak({ goals: { daily_streak: 7 } }), 7);
});

test("an absent streak is blank, not zero", () => {
	// Writing 0 would show a broken streak that never happened.
	assert.equal(readDailyStreak({}), "");
	assert.equal(readDailyStreak({ goals: {} }), "");
});

test("day totals come from either nesting, and default to zero", () => {
	assert.deepEqual(readDayTotals(STATS, TODAY), {
		completed: 12,
		added: 7,
	});
	assert.deepEqual(
		readDayTotals(
			{
				completed: {
					days_items: [
						{
							date: TODAY,
							total_completed: 3,
						},
					],
				},
			},
			TODAY,
		),
		{ completed: 3, added: 0 },
	);
	assert.deepEqual(readDayTotals({}, TODAY), { completed: 0, added: 0 });
});

test("a day missing from the payload reads as zero, not as yesterday's", () => {
	// The nightly run fires at 23:30 and the day may not be in the payload yet.
	assert.deepEqual(readDayTotals(STATS, "2026-09-20"), {
		completed: 0,
		added: 0,
	});
});

// ── the delta ────────────────────────────────────────────────────────────────

test("the delta is measured against the last row present", () => {
	// Deliberately the LAST row rather than "yesterday": if a day was missed, the
	// gap belongs in the number rather than being attributed to a day that has
	// no row.
	const rows: Row[] = [
		KARMA_STATS_HEADER,
		["2026-09-12", 14000, 0, 5, 5, 29, "2026-09-12"],
		["2026-09-13", 14400, 400, 9, 4, 30, "2026-09-13"],
	];
	assert.equal(readPreviousKarma(rows), 14400);

	const plan = planKarmaStats(
		{ stats: STATS, existingRows: rows },
		TAB,
		TODAY,
	);
	const [write] = plan.writes;
	assert.ok(write && write.mode === "upsert");
	assert.equal(write.rows[0]?.[2], 100, "14500 − 14400");
});

test("an empty tab gives a delta equal to the karma itself", () => {
	const plan = planKarmaStats(
		{ stats: STATS, existingRows: [KARMA_STATS_HEADER] },
		TAB,
		TODAY,
	);
	const [write] = plan.writes;
	assert.ok(write && write.mode === "upsert");
	assert.equal(write.rows[0]?.[2], 14500);
});

test("a RE-RUN does not measure today against itself", () => {
	// THE bug this guards. Without it, a second run of the same day computes the
	// delta against the row it is about to overwrite and always reports 0 —
	// which reads as "no karma earned today" rather than as a re-run.
	const rows: Row[] = [
		KARMA_STATS_HEADER,
		["2026-09-13", 14400, 400, 9, 4, 30, "2026-09-13"],
		["2026-09-14", 14480, 80, 10, 6, 31, "2026-09-14"],
	];
	const plan = planKarmaStats(
		{ stats: STATS, existingRows: rows },
		TAB,
		TODAY,
	);
	const [write] = plan.writes;
	assert.ok(write && write.mode === "upsert");
	assert.equal(
		write.rows[0]?.[2],
		100,
		"still measured against 2026-09-13",
	);
});

test("a Date cell in the key column is matched, not missed", () => {
	// Sheets returns column A as a Date once the column is date-formatted, and a
	// raw === against "2026-09-14" silently never matches — the legacy code
	// names this trap explicitly.
	const rows: Row[] = [
		KARMA_STATS_HEADER,
		["2026-09-13", 14400, 0, 0, 0, 30, "2026-09-13"],
		[
			new Date("2026-09-14T00:00:00Z"),
			14480,
			0,
			0,
			0,
			31,
			"2026-09-14",
		],
	];
	const plan = planKarmaStats(
		{ stats: STATS, existingRows: rows },
		TAB,
		TODAY,
	);
	const [write] = plan.writes;
	assert.ok(write && write.mode === "upsert");
	assert.equal(
		write.rows[0]?.[2],
		100,
		"today's Date-typed row was recognised, so the delta skipped it",
	);
});

// ── the plan ─────────────────────────────────────────────────────────────────

test("the plan upserts by date, so a row keeps its position", () => {
	// The tab is read as a time series; a row that jumped to the bottom on every
	// update would scramble the order Looker charts.
	const plan = planKarmaStats(
		{ stats: STATS, existingRows: [KARMA_STATS_HEADER] },
		TAB,
		TODAY,
	);
	assert.equal(plan.writes.length, 1);
	const [write] = plan.writes;
	assert.ok(write && write.mode === "upsert");
	assert.equal(write.tab, TAB);
	assert.equal(write.keyColumnIndex, 0);
});

test("the row carries every column in order", () => {
	const plan = planKarmaStats(
		{ stats: STATS, existingRows: [KARMA_STATS_HEADER] },
		TAB,
		TODAY,
	);
	const [write] = plan.writes;
	assert.ok(write && write.mode === "upsert");
	assert.equal(write.rows[0]?.length, KARMA_STATS_HEADER.length);
	assert.deepEqual(write.rows[0], [
		"2026-09-14",
		14500,
		14500,
		12,
		7,
		31,
		"2026-09-14",
	]);
});

test("the plan persists no state", () => {
	const plan = planKarmaStats(
		{ stats: STATS, existingRows: [KARMA_STATS_HEADER] },
		TAB,
		TODAY,
	);
	assert.deepEqual(plan.stateToPersist, {});
});
