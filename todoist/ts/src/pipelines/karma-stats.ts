// ─────────────────────────────────────────────────────────────────────────────
// KarmaStats — one row per day, and the first tab that UPSERTS
//
// Todoist's own productivity numbers. Unlike the snapshot tabs, a day's row is
// UPDATED IN PLACE when it already exists rather than replaced: the tab is read
// as a time series, and a row that jumped to the bottom on every re-run would
// scramble the order Looker charts.
//
// THE PARSING IS DEFENSIVE ON PURPOSE. The stats payload moved between Sync v9
// and v1, and the legacy code reads every field through a chain of fallbacks
// because it was hit by the move. Those fallbacks are carried across verbatim —
// they are evidence about a real API, not defensive habit.
// ─────────────────────────────────────────────────────────────────────────────

import type { DayKey } from "../core/dates.ts";
import { cellValueToDayKey } from "../core/dates.ts";
import { toNumberOrZero } from "../core/numbers.ts";
import { upsertBy, type WritePlan } from "../core/write-plan.ts";
import type { Row } from "../ports/values.ts";

export const KARMA_STATS_HEADER: Row = [
	"date",
	"karma",
	"karma_delta",
	"completed_today",
	"added_today",
	"daily_streak",
	"snapshot_date",
];

// Column A is the key: one row per day.
const DATE_COLUMN = 0;
// Column B, read back to compute the delta.
const KARMA_COLUMN = 1;

// The stats payload, as much of it as this reads. Every path is optional because
// which one is populated depends on the endpoint that answered.
export interface TodoistStats {
	readonly karma?: unknown;
	readonly user?: { readonly karma?: unknown };
	readonly days_items?: readonly {
		readonly date?: string;
		readonly total_completed?: unknown;
		readonly total_added?: unknown;
	}[];
	readonly completed?: {
		readonly days_items?: readonly {
			readonly date?: string;
			readonly total_completed?: unknown;
			readonly total_added?: unknown;
		}[];
	};
	readonly goals?: {
		readonly current_daily_streak?: { readonly count?: unknown };
		readonly daily_streak?: unknown;
	};
}

export interface KarmaStatsSnapshot {
	readonly stats: TodoistStats;
	// The tab as it stands, header included. Needed for two things: the previous
	// karma value, and whether today's row already exists.
	readonly existingRows: readonly Row[];
}

// Karma, from wherever this payload happens to carry it.
export function readKarma(stats: TodoistStats): number {
	return toNumberOrZero(stats.karma ?? stats.user?.karma);
}

// The daily streak. Two shapes, and "" when neither is present — an absent
// streak is not a streak of zero, and writing 0 would show a broken streak that
// never happened.
export function readDailyStreak(stats: TodoistStats): number | "" {
	const nested = stats.goals?.current_daily_streak?.count;
	if (nested !== undefined && nested !== null)
		return toNumberOrZero(nested);
	const flat = stats.goals?.daily_streak;
	if (flat !== undefined && flat !== null) return toNumberOrZero(flat);
	return "";
}

// Today's per-day figures, or zeroes when the day is not in the payload yet.
export function readDayTotals(
	stats: TodoistStats,
	today: DayKey,
): { completed: number; added: number } {
	const days = stats.days_items ?? stats.completed?.days_items ?? [];
	const todayEntry = days.find((day) => day.date === today);
	return {
		completed: toNumberOrZero(todayEntry?.total_completed),
		added: toNumberOrZero(todayEntry?.total_added),
	};
}

// The karma value on the LAST row of the tab.
//
// Deliberately the last row rather than "yesterday's row": the delta is against
// the previous observation, and if a day was missed the gap belongs in the
// number rather than being silently attributed to the missing day.
export function readPreviousKarma(existingRows: readonly Row[]): number {
	if (existingRows.length < 2) return 0; // header only, or empty
	const lastRow = existingRows[existingRows.length - 1];
	return toNumberOrZero(lastRow?.[KARMA_COLUMN]);
}

// Does the tab already hold a row for this day?
//
// Uses cellValueToDayKey because Sheets returns column A as a Date once the
// column is date-formatted — a raw === against "2026-09-14" silently never
// matches, and the legacy code notes that exact trap.
export function hasRowForDay(
	existingRows: readonly Row[],
	day: DayKey,
): boolean {
	return existingRows
		.slice(1)
		.some((row) => cellValueToDayKey(row[DATE_COLUMN]) === day);
}

export function planKarmaStats(
	snapshot: KarmaStatsSnapshot,
	tab: string,
	today: DayKey,
): WritePlan {
	const karma = readKarma(snapshot.stats);
	const totals = readDayTotals(snapshot.stats, today);

	// The delta is computed against the previous row only when today's row is
	// NOT already present. Re-running the same day must not measure today
	// against itself and report a delta of zero.
	const alreadyToday = hasRowForDay(snapshot.existingRows, today);
	const previousKarma = alreadyToday
		? readPreviousKarmaExcludingToday(snapshot.existingRows, today)
		: readPreviousKarma(snapshot.existingRows);

	const row: Row = [
		today,
		karma,
		karma - previousKarma,
		totals.completed,
		totals.added,
		readDailyStreak(snapshot.stats),
		today,
	];

	return {
		writes: [upsertBy(tab, DATE_COLUMN, [row])],
		stateToPersist: {},
		logLines: [
			`KarmaStats: karma ${karma} (${karma - previousKarma >= 0 ? "+" : ""}${karma - previousKarma}), ` +
				`${totals.completed} completed on ${today}`,
		],
	};
}

// The karma on the last row that is NOT today's.
//
// Only reachable on a re-run. Without it, a second run of the same day would
// compute the delta against the row it is about to overwrite and always report
// zero — which reads as "no karma earned today" rather than as a re-run.
function readPreviousKarmaExcludingToday(
	existingRows: readonly Row[],
	today: DayKey,
): number {
	for (let index = existingRows.length - 1; index >= 1; index -= 1) {
		const row = existingRows[index];
		if (!row) continue;
		if (cellValueToDayKey(row[DATE_COLUMN]) === today) continue;
		return toNumberOrZero(row[KARMA_COLUMN]);
	}
	return 0;
}
