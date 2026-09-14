// ─────────────────────────────────────────────────────────────────────────────
// HabitDaily — the dense habit × day grid, and the most logic of any tab
//
// It reads TWO tabs and writes a trailing window, which is why it runs LAST in
// the orchestrator: both must already hold today's rows when it starts.
//
//   * `RecurringStatus` is the SPINE — one entry per (habit, day), including the
//     days a habit was skipped. That is the entire reason it is read instead of
//     Completions, which can only say what was done.
//   * `Completions` is the TRUTH about whether a habit was actually checked off.
//
// ⚠️ DUE-NESS COMES FROM THE WORKDAY CONTRACT, NOT THE SNAPSHOT'S DUE DATE. A
// weekday on which the habit existed — it has a spine row — is a day it was
// owed. The snapshot due date is untrustworthy for this: the reschedule trigger
// runs ~20:09, three hours before the snapshot, bumping every skipped habit to
// tomorrow and making it read "not scheduled" instead of missed (verified in the
// activity log). The snapshot due date is kept as drift information only.
// ─────────────────────────────────────────────────────────────────────────────

import {
	addDaysToDay,
	cellValueToDayKey,
	cellValueToLocalDay,
	type DayKey,
} from "../core/dates.ts";
import {
	habitDayStatus,
	habitDueTime,
	nextStreak,
	type HabitDayStatus,
} from "../core/habits.ts";
import { hasLabel, shortHabitName, toLabelList } from "../core/labels.ts";
import { toNumberOrZero } from "../core/numbers.ts";
import { replaceWhere, type WritePlan } from "../core/write-plan.ts";
import type { CellValue, Row } from "../ports/values.ts";

export const HABIT_DAILY_HEADER: Row = [
	"date",
	"task_id",
	"habit",
	"habit_full",
	"section_name",
	"labels",
	"status",
	"completed",
	"due",
	"completed_at",
	"due_date",
	"priority",
	"recurrence_string",
	"sync_date",
	"due_time",
	"streak",
];

export const HABITS_LABEL = "habits";

// Derived from the header so the two can never drift apart.
const DATE_COLUMN = HABIT_DAILY_HEADER.indexOf("date");
const TASK_ID_COLUMN = HABIT_DAILY_HEADER.indexOf("task_id");
const STATUS_COLUMN = HABIT_DAILY_HEADER.indexOf("status");
const STREAK_COLUMN = HABIT_DAILY_HEADER.indexOf("streak");

// The nightly window, and the width of a backfill.
export const HABIT_DAILY_WINDOW_DAYS = 7;
export const HABIT_DAILY_BACKFILL_DAYS = 400;

// RecurringStatus positions.
const SPINE_DATE = 0;
const SPINE_TASK_ID = 1;
const SPINE_CONTENT = 2;
const SPINE_SECTION = 4;
const SPINE_LABELS = 5;
const SPINE_PRIORITY = 6;
const SPINE_DUE_DATE = 7;
const SPINE_RECURRENCE = 8;

// Completions positions.
const COMPLETION_COMPLETED_AT = 0;
const COMPLETION_TASK_ID = 1;
const COMPLETION_LABELS = 6;
const COMPLETION_IS_RECURRING = 8;

export interface SpineEntry {
	readonly date: DayKey;
	readonly taskId: string;
	readonly content: string;
	readonly sectionName: string;
	readonly labels: readonly string[];
	readonly priority: CellValue;
	readonly dueDate: string;
	// RAW, not normalised: the time component is the due_time fallback.
	readonly dueAt: CellValue;
	readonly recurrence: string;
}

export interface HabitDailySnapshot {
	readonly spineRows: readonly Row[]; // RecurringStatus
	readonly completionRows: readonly Row[]; // Completions
	readonly existingRows: readonly Row[]; // HabitDaily itself
	readonly timezone: string;
}

// Every habit-labelled spine entry from `cutoff` onward.
//
// Rows dated AFTER today are kept but can never score as a miss — habitDayStatus
// reads them as "not_due". A snapshot cannot observe a day that has not happened,
// so a future label is always a stamping artifact; showing tomorrow's habits as
// pre-emptively missed was the thing worth preventing, not the row itself.
export function readHabitSpine(
	snapshot: HabitDailySnapshot,
	cutoff: DayKey,
): SpineEntry[] {
	const entries: SpineEntry[] = [];
	for (const row of snapshot.spineRows.slice(1)) {
		const date = cellValueToDayKey(row[SPINE_DATE]);
		if (!date || date < cutoff) continue;

		const labels = toLabelList(row[SPINE_LABELS]);
		if (!hasLabel(labels, HABITS_LABEL)) continue;

		entries.push({
			date,
			taskId: String(row[SPINE_TASK_ID] ?? ""),
			content: String(row[SPINE_CONTENT] ?? ""),
			sectionName: String(row[SPINE_SECTION] ?? ""),
			labels,
			priority: row[SPINE_PRIORITY] ?? 1,
			dueDate: cellValueToDayKey(row[SPINE_DUE_DATE]),
			dueAt: row[SPINE_DUE_DATE] ?? "",
			recurrence: String(row[SPINE_RECURRENCE] ?? ""),
		});
	}
	return entries;
}

// Which (habit, local day) pairs were actually checked off.
//
// The VALUE is the local clock time, not a bare flag — "done at 05:22" is worth
// having. Presence is what marks a day done, so an empty string still counts.
export function buildCompletionIndex(
	snapshot: HabitDailySnapshot,
): Map<string, string> {
	const index = new Map<string, string>();
	for (const row of snapshot.completionRows.slice(1)) {
		if (
			String(
				row[COMPLETION_IS_RECURRING] ?? "",
			).toUpperCase() !== "TRUE"
		) {
			continue;
		}
		if (
			!hasLabel(
				toLabelList(row[COMPLETION_LABELS]),
				HABITS_LABEL,
			)
		)
			continue;

		const day = cellValueToLocalDay(
			row[COMPLETION_COMPLETED_AT],
			snapshot.timezone,
		);
		if (!day) continue;

		index.set(
			`${String(row[COMPLETION_TASK_ID] ?? "")}|${day}`,
			localClockTime(
				row[COMPLETION_COMPLETED_AT] ?? "",
				snapshot.timezone,
			),
		);
	}
	return index;
}

function localClockTime(value: CellValue, timezone: string): string {
	if (value === null || value === undefined || value === "") return "";
	const instant = value instanceof Date ? value : new Date(String(value));
	if (Number.isNaN(instant.getTime())) return "";
	return new Intl.DateTimeFormat("en-GB", {
		timeZone: timezone,
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).format(instant);
}

// Streak values to continue from: for each habit, the streak on its LAST row
// dated before `cutoff` — the newest row this rebuild will not overwrite.
//
// This is what keeps a nightly 7-day window and a 400-day backfill in agreement,
// and how any synthesised pre-spine block feeds the observed one.
export function readStreakSeeds(
	existingRows: readonly Row[],
	cutoff: DayKey,
): Map<string, number> {
	const newestDayPerHabit = new Map<string, DayKey>();
	const seeds = new Map<string, number>();

	for (const row of existingRows.slice(1)) {
		const date = cellValueToDayKey(row[DATE_COLUMN]);
		if (!date || date >= cutoff) continue;

		const taskId = String(row[TASK_ID_COLUMN] ?? "");
		const newest = newestDayPerHabit.get(taskId);
		if (newest === undefined || date > newest) {
			newestDayPerHabit.set(taskId, date);
			seeds.set(taskId, toNumberOrZero(row[STREAK_COLUMN]));
		}
	}
	return seeds;
}

export interface HabitDailyPlanOptions {
	readonly windowDays: number;
}

export function planHabitDaily(
	snapshot: HabitDailySnapshot,
	tab: string,
	today: DayKey,
	options: HabitDailyPlanOptions = {
		windowDays: HABIT_DAILY_WINDOW_DAYS,
	},
): WritePlan {
	// The spine is the only thing this can be built from. Without it, writing
	// anything would clear the grid and refill it with nothing.
	if (snapshot.spineRows.length < 2) {
		return {
			writes: [],
			stateToPersist: {},
			logLines: [
				"HabitDaily: no RecurringStatus rows — nothing to build the grid " +
					"from, so nothing is written. Run syncRecurringStatus first.",
			],
		};
	}

	// An EMPTY tab gets the full span regardless of the window asked for.
	// Without this, the first nightly run after a layout change would clear the
	// whole grid and refill only a week.
	const tabIsEmpty = snapshot.existingRows.length < 2;
	const windowDays =
		tabIsEmpty && options.windowDays < HABIT_DAILY_BACKFILL_DAYS
			? HABIT_DAILY_BACKFILL_DAYS
			: options.windowDays;

	const cutoff = addDaysToDay(today, -windowDays);
	const spine = readHabitSpine(snapshot, cutoff);

	// ⚠️ NEVER LET THE REPLACE REACH BELOW THE OBSERVED SPINE. A rebuild can only
	// regenerate days the spine has, so a 400-day cutoff would DELETE any
	// synthesised pre-spine rows while writing nothing in their place. Clamping
	// the replace boundary to the earliest spine day leaves that block alone.
	let replaceCutoff = cutoff;
	if (spine.length > 0) {
		const earliest = spine.reduce(
			(lowest, entry) =>
				entry.date < lowest ? entry.date : lowest,
			spine[0]?.date ?? cutoff,
		);
		if (earliest > replaceCutoff) replaceCutoff = earliest;
	}

	// Read BEFORE the replace, obviously, and keyed per habit.
	const streaks = readStreakSeeds(snapshot.existingRows, replaceCutoff);
	const completed = buildCompletionIndex(snapshot);

	// DATE ORDER is what makes the streak thread meaningful. RecurringStatus is
	// appended a day at a time so the spine already arrives sorted, but a manual
	// edit would silently scramble every streak — cheap insurance.
	const ordered = [...spine].sort((a, b) =>
		a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
	);

	const rows: Row[] = ordered.map((entry) => {
		const key = `${entry.taskId}|${entry.date}`;
		const wasCompleted = completed.has(key);
		const status = habitDayStatus(entry.date, wasCompleted, today);
		const streak = nextStreak(
			streaks.get(entry.taskId) ?? 0,
			status,
		);
		streaks.set(entry.taskId, streak);

		return [
			entry.date,
			entry.taskId,
			shortHabitName(entry.content),
			entry.content,
			entry.sectionName,
			entry.labels.join(","),
			status,
			wasCompleted ? 1 : 0,
			// Everything except not_due is OWED, which keeps a rest-day
			// check-off at due = 1 rather than discarding it.
			status === "not_due" ? 0 : 1,
			wasCompleted ? (completed.get(key) ?? "") : "",
			entry.dueDate,
			entry.priority,
			entry.recurrence,
			today,
			habitDueTime(
				entry.recurrence,
				entry.dueAt,
				snapshot.timezone,
			),
			streak,
		];
	});

	const counts = countStatuses(rows);
	return {
		writes: [
			replaceWhere(
				tab,
				DATE_COLUMN,
				{ onOrAfter: replaceCutoff },
				rows,
			),
		],
		stateToPersist: {},
		logLines: [
			`HabitDaily: rebuilt ${rows.length} row(s) since ${replaceCutoff} — ` +
				`${counts.done} done, ${counts.missed} missed, ${counts.pending} pending, ` +
				`${counts.not_due} not due (tz ${snapshot.timezone})` +
				(tabIsEmpty
					? " [auto-backfill: tab was empty]"
					: ""),
		],
	};
}

function countStatuses(rows: readonly Row[]): Record<HabitDayStatus, number> {
	const counts: Record<HabitDayStatus, number> = {
		done: 0,
		missed: 0,
		pending: 0,
		not_due: 0,
	};
	for (const row of rows) {
		const status = String(
			row[STATUS_COLUMN] ?? "",
		) as HabitDayStatus;
		if (status in counts) counts[status] += 1;
	}
	return counts;
}
