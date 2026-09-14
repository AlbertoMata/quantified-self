// ─────────────────────────────────────────────────────────────────────────────
// Overdue — the simplest pipeline, and the one that proves the shape
//
// One call → one replaceWhere. Every other tab is a variation on this, so the
// worked example is here rather than in a design document: a pure function from
// an in-memory snapshot to a WritePlan, with no I/O anywhere in it.
//
// The tab is a DAILY SNAPSHOT of what was overdue at the moment the run took
// it. Re-running the same day replaces that day's rows rather than adding to
// them — which is what `replaceWhere { equals: today }` says, and what the
// legacy code spelled out as a reverse row-by-row delete loop.
// ─────────────────────────────────────────────────────────────────────────────

import { daysBetweenDays, type DayKey } from "../core/dates.ts";
import { replaceWhere, type WritePlan } from "../core/write-plan.ts";
import type { Row } from "../ports/values.ts";
import type { TodoistTask } from "../services/todoist/responses.ts";

// The schema's column order, from todoist/schema/overdue.md. The header is the
// contract; a doc-parity test (Doc upkeep #5) will check this against it.
export const OVERDUE_HEADER: Row = [
	"snapshot_date",
	"task_id",
	"task_content",
	"project_name",
	"labels",
	"due_date",
	"days_overdue",
	"priority",
	"is_recurring",
	"parent_id",
];

// Column A, which replaceWhere matches on.
const SNAPSHOT_DATE_COLUMN = 0;

export interface OverdueSnapshot {
	readonly overdueTasks: readonly TodoistTask[];
	readonly projectNamesById: Readonly<Record<string, string>>;
}

// Build one row per overdue task.
//
// `today` is passed in rather than read from a clock, so the function is pure
// and a test can ask what it does at any date. It must be the LOCAL day: the
// trigger fires at 23:30 America/Mexico_City, which is already tomorrow in UTC,
// and a UTC stamp labelled every nightly snapshot with the NEXT day — inflating
// days_overdue by one for months before anyone noticed.
export function buildOverdueRows(
	snapshot: OverdueSnapshot,
	today: DayKey,
): Row[] {
	return snapshot.overdueTasks.map((task) => {
		const dueDate = task.due?.date ?? "";

		// A task with no due date cannot be overdue by any amount, so it reads
		// as 0 rather than as a guess. The legacy code reached the same answer
		// by defaulting the due date to today.
		const daysOverdue = dueDate
			? (daysBetweenDays(dueDate, today) ?? 0)
			: 0;

		return [
			today,
			String(task.id ?? ""),
			task.content ?? "",
			snapshot.projectNamesById[
				String(task.project_id ?? "")
			] ?? "",
			(task.labels ?? []).join(","),
			dueDate,
			daysOverdue,
			// Todoist omits priority 1 (the default) rather than sending it.
			task.priority ?? 1,
			task.due?.is_recurring === true ? "TRUE" : "FALSE",
			// The self-blend key: parent_id ↔ task_id, which is how a Looker
			// report attaches parent details to a subtask.
			task.parent_id === undefined || task.parent_id === null
				? ""
				: String(task.parent_id),
		];
	});
}

// The plan. Pure: snapshot in, WritePlan out, nothing touched.
export function planOverdue(
	snapshot: OverdueSnapshot,
	tab: string,
	today: DayKey,
): WritePlan {
	const rows = buildOverdueRows(snapshot, today);

	return {
		writes: [
			// Even with zero rows this still runs, and that is deliberate: a day
			// with nothing overdue must CLEAR today's stale rows rather than
			// leave yesterday's snapshot looking like today's.
			replaceWhere(
				tab,
				SNAPSHOT_DATE_COLUMN,
				{ equals: today },
				rows,
			),
		],
		// Overdue keeps no cursor. It is a fresh snapshot every time, which is
		// why it is the safest pipeline to port first.
		stateToPersist: {},
		logLines: [
			`Overdue: ${rows.length} task(s) overdue on ${today}`,
		],
	};
}
