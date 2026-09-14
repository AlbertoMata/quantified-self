// ─────────────────────────────────────────────────────────────────────────────
// Habits — the verdict for one (habit, day), and the streak that follows
//
// `HabitDaily` is a DENSE grid: it carries a row for every habit on every day,
// including days nothing happened. That is the whole reason `RecurringStatus`
// exists — `Completions` can only say what was done, and a habit's history is
// mostly the days it was not.
//
// Everything here is pure. The grid builder and the history synthesiser both go
// through `habitDayStatus`, so there is exactly one definition of what "missed"
// means.
// ─────────────────────────────────────────────────────────────────────────────

import type { DayKey } from "./dates.ts";

export type HabitDayStatus = "done" | "pending" | "missed" | "not_due";

// Saturday/Sunday, for a plain YYYY-MM-DD.
//
// Anchored to UTC on purpose. `new Date("2026-08-15")` parses as UTC midnight,
// so reading its weekday through a UTC-behind timezone reports every Saturday as
// a Friday. A bare calendar string has a timezone-free weekday — read it back in
// UTC or not at all.
export function isRestDay(day: DayKey): boolean {
	const dayOfWeek = new Date(`${day}T00:00:00Z`).getUTCDay();
	return dayOfWeek === 0 || dayOfWeek === 6;
}

// The verdict for one (habit, day).
//
//   done     a completion landed on that local day
//   pending  owed, still open, and the day is not over yet (only ever today)
//   missed   owed, the day is over, nothing recorded
//   not_due  not owed: a weekend rest day, or a day that has not arrived
//
// `pending` exists because THE DAY IN PROGRESS IS NOT A FAILURE. The nightly
// snapshot writes today's spine rows at 23:30, and without this the grid would
// score every not-yet-done habit as missed the moment they appeared — and a
// manual backfill at noon would do it for the whole day. The verdict is
// transient: the next nightly rebuild covers the trailing window, so today's
// pending rows settle into done or missed tomorrow.
//
// Order matters. `wasCompleted` is checked FIRST so a weekend check-off counts —
// doing a habit on a rest day is not nothing, and testing isRestDay first would
// throw it away.
export function habitDayStatus(
	day: DayKey,
	wasCompleted: boolean,
	today: DayKey,
): HabitDayStatus {
	if (wasCompleted) return "done";
	if (day > today) return "not_due"; // hasn't happened; cannot be a miss
	if (isRestDay(day)) return "not_due";
	return day === today ? "pending" : "missed";
}

// One step of a habit's streak: the consecutive-done count carried forward.
//
// `pending` and `not_due` CARRY rather than break. A weekend, a future day and
// the day still in progress are not failures — and since a weekend check-off
// still returns "done", a habit done on Saturday still increments.
export function nextStreak(previous: number, status: HabitDayStatus): number {
	if (status === "done") return previous + 1;
	if (status === "missed") return 0;
	return previous;
}

// The time of day a recurrence rule fires, as "HH:mm" (24h), or "" when the rule
// carries no time ("every workday").
//
// Todoist keeps it inside the human-readable rule string — "every workday at
// 8:30 pm" — which sorts alphabetically, so the grid stores the parsed value
// instead: Looker cannot order a day's habits by a phrase.
//
// BOTH SPELLINGS have to be matched. Todoist echoes a rule back with whatever
// separator it was typed with, so "every workday @ 5:25 am" and "every workday
// at 5:25 am" are the same rule stored two ways; matching only "at" silently
// blanked due_time for five real habits. The `at` keeps a word boundary on BOTH
// sides so the "at" inside "Saturday" can never match.
export function dueTimeOf(recurrence: unknown): string {
	const match = /(?:\bat\b|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(
		String(recurrence ?? ""),
	);
	if (!match) return "";

	let hour = Number.parseInt(match[1] ?? "", 10);
	const minute = match[2] ? Number.parseInt(match[2], 10) : 0;
	const meridiem = (match[3] ?? "").toLowerCase();

	if (Number.isNaN(hour) || hour > 23 || minute > 59) return "";
	if (meridiem === "pm" && hour < 12) hour += 12;
	if (meridiem === "am" && hour === 12) hour = 0; // 12:30 am is 00:30

	return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// The clock time carried by a due DATE, as "HH:mm", or "" for an all-day date.
//
// The fallback for a habit whose time of day never made it into the recurrence
// string: "Wash your face" is due at 20:30 every workday but its rule reads
// plainly "every workday", so dueTimeOf has nothing to parse. The v1 API returns
// due.date as a local floating datetime ("2026-08-17T05:10:00") when a time is
// set and a bare date otherwise — exactly the distinction this needs.
//
// ⚠️ The string branch NEVER constructs a Date. Routing a bare "2026-09-07"
// through `new Date()` parses it as UTC midnight and, in a UTC-behind zone,
// reports a due time of 18:00 the day before — the same trap isRestDay
// documents. It reads the digits instead.
export function clockTimeOf(value: unknown, timezone: string): string {
	if (value === null || value === undefined || value === "") return "";

	if (value instanceof Date) {
		const formatted = new Intl.DateTimeFormat("en-GB", {
			timeZone: timezone,
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		}).format(value);
		// An all-day cell is stored as midnight, so midnight has to read as
		// "no time". A habit due at exactly 00:00 is not a thing.
		return formatted === "00:00" || formatted === "24:00"
			? ""
			: formatted;
	}

	const match = /[T ](\d{1,2}):(\d{2})/.exec(String(value));
	if (!match) return ""; // "2026-09-07" — all-day, no time of day to carry

	const hour = Number.parseInt(match[1] ?? "", 10);
	const minute = Number.parseInt(match[2] ?? "", 10);
	if (Number.isNaN(hour) || hour > 23 || minute > 59) return "";
	return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// The time of day a habit is owed: its recurrence rule if it carries one, its due
// date's clock time otherwise, and "" when neither says.
//
// The order is the legacy precedence: the rule is what the author wrote, the due
// date is what Todoist computed from it.
export function habitDueTime(
	recurrence: unknown,
	dueDate: unknown,
	timezone: string,
): string {
	return dueTimeOf(recurrence) || clockTimeOf(dueDate, timezone);
}
