// ─────────────────────────────────────────────────────────────────────────────
// Bill cycles — did this cycle close by its due date?
//
// ⚠️ READ THIS BEFORE TRUSTING A NUMBER. Todoist records when you TICKED THE
// BOX. It has no idea when money moved. Every value here measures
// ADMINISTRATIVE timeliness, not payment timeliness, and the names say so:
// `closed` / `closed_late`, `daysToClose`. A bill paid on time and ticked three
// days later reads `closed_late`, correctly — the CYCLE closed late even though
// the payment did not.
//
// An earlier design claimed `completed_at` was worthless and Todoist's
// `was_overdue` was "the honest signal". That was wrong, and is worth stating so
// it is not re-derived: **`was_overdue` IS `completed_at` vs the due date**,
// computed by Todoist. The same measurement at better precision, not independent
// evidence. Nothing in the payload knows about payments.
//
// One real consequence: a due TIME can make on-time closure impossible. `PAY THE
// MORTGAGE` is due "every 2nd at 2:00 am", so it is overdue from 02:00 that day
// and every waking-hour check-off is late by construction. That is a Todoist-side
// fix, logged in life-areas.md, not something to paper over here.
// ─────────────────────────────────────────────────────────────────────────────

import { daysBetweenDays, type DayKey } from "./dates.ts";

export type BillCycleStatus = "closed" | "closed_late" | "open" | "overdue";

// Todoist's own flag, as it is stored in the sheet: "TRUE", "FALSE", or blank
// for unknown. Kept as the three-state string rather than a boolean because
// BLANK IS NOT FALSE, and collapsing it to one would quietly score every
// unverifiable row as on time.
export type WasOverdue = "TRUE" | "FALSE" | "" | null | undefined;

// The status of one bill cycle.
//
// `was_overdue` wins where present because it is TIMESTAMP-precise, while the
// date fallback is only DAY-precise. The two can legitimately disagree on a
// same-day close: a task due 02:00 and ticked at 09:00 the same day is
// `was_overdue = TRUE` but zero days late. Trusting the flag first keeps the
// answer consistent with what Todoist itself shows.
//
// A blank flag means UNKNOWN and falls through to the dates rather than
// defaulting to `closed`.
//
// `open` / `overdue` describe the LIVE state of an unticked cycle. They make no
// claim about payment either — only about whether the task is past due right now.
export function billCycleStatus(
	closedAt: DayKey | "" | null | undefined,
	cycleDueDate: DayKey | "" | null | undefined,
	wasOverdue: WasOverdue,
	today: DayKey,
): BillCycleStatus {
	if (closedAt) {
		if (wasOverdue === "TRUE") return "closed_late";
		if (wasOverdue === "FALSE") return "closed";
		const lag = daysBetweenDays(cycleDueDate, closedAt);
		return lag !== null && lag > 0 ? "closed_late" : "closed";
	}
	const overdueBy = daysBetweenDays(cycleDueDate, today);
	return overdueBy !== null && overdueBy > 0 ? "overdue" : "open";
}

// Due → close lag in days. Negative means closed early.
//
// While a cycle is still open it is measured against today, so the number keeps
// growing rather than sitting blank — an open cycle eleven days past due should
// read as eleven, not as nothing.
export function daysToClose(
	closedAt: DayKey | "" | null | undefined,
	cycleDueDate: DayKey | "" | null | undefined,
	today: DayKey,
): number | null {
	return daysBetweenDays(cycleDueDate, closedAt ? closedAt : today);
}

// The cycle a due date belongs to, as YYYY-MM.
export function cycleOf(cycleDueDate: DayKey | "" | null | undefined): string {
	const day = String(cycleDueDate ?? "").slice(0, 7);
	return /^\d{4}-\d{2}$/.test(day) ? day : "";
}

// Consecutive cycles closed BY their due date.
//
// Only `closed_late` breaks it. An UNFINISHED cycle carries — including an
// `overdue` one — because it has not failed yet: it can still be closed, and
// closing it late is what the break is for. The legacy code states the same
// rule as "an unfinished cycle is not yet a failure, exactly as a day in
// progress is not", and routes it through the habit streak function to make
// that parallel literal.
//
// I would argue the other way on a blank page: a cycle eleven days past due
// looks like a failure in progress, and carrying the streak flatters it. But
// PARITY IS THE BAR until Phase E — the port has to reproduce the legacy number
// before it is allowed to improve on it, or a diff cannot tell a fix from a bug.
// Logged as a question for after cutover rather than changed here.
export function nextOnTimeCloseStreak(
	previous: number,
	status: BillCycleStatus,
): number {
	if (status === "closed") return previous + 1;
	if (status === "closed_late") return 0;
	return previous; // open and overdue both carry
}
