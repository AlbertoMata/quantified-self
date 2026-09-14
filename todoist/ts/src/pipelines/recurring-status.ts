// ─────────────────────────────────────────────────────────────────────────────
// RecurringStatus — the SPINE
//
// A daily snapshot of every active recurring task and its current due date. When
// a task's due date advances between consecutive snapshots, it was completed on
// the earlier one.
//
// WHY IT EXISTS ALONGSIDE Completions, since it looks redundant: it is the only
// tab that records a habit's EXISTENCE on days nothing happened. `Completions`
// can only say what was done, and `HabitDaily` is a dense grid — it needs a row
// for the day a habit was skipped, and that row can only come from here.
//
// It is also a second view of the same behaviour, kept because a snapshot
// degrades differently from an event stream: it still shows state if
// `/activities` is unavailable, but it cannot see two completions of the same
// task between runs. Prefer Completions for counting; use this to reconstruct
// state on days the event source came back empty.
//
// Sub-habits (checklist steps under a habit) are undated and non-recurring by
// design — Todoist unchecks them when their parent recurs — so they never reach
// this tab. A step appearing here means it was given a recurrence it should not
// have.
// ─────────────────────────────────────────────────────────────────────────────

import type { DayKey } from "../core/dates.ts";
import { replaceWhere, type WritePlan } from "../core/write-plan.ts";
import type { Row } from "../ports/values.ts";
import type { TodoistTask } from "../services/todoist/responses.ts";

export const RECURRING_STATUS_HEADER: Row = [
	"snapshot_date",
	"task_id",
	"content",
	"project_name",
	"section_name",
	"labels",
	"priority",
	"due_date",
	"recurrence_string",
	"parent_id",
];

const SNAPSHOT_DATE_COLUMN = 0;

export interface RecurringStatusSnapshot {
	readonly recurringTasks: readonly TodoistTask[];
	readonly projectNamesById: Readonly<Record<string, string>>;
	readonly sectionNamesById: Readonly<Record<string, string>>;
}

export function buildRecurringStatusRows(
	snapshot: RecurringStatusSnapshot,
	today: DayKey,
): Row[] {
	return snapshot.recurringTasks.map((task) => [
		today,
		String(task.id ?? ""),
		task.content ?? "",
		snapshot.projectNamesById[String(task.project_id ?? "")] ?? "",
		// A task with no section is not an error — most tasks have none — so an
		// absent section_id reads as empty rather than being looked up as "".
		task.section_id === undefined || task.section_id === null
			? ""
			: (snapshot.sectionNamesById[String(task.section_id)] ??
				""),
		(task.labels ?? []).join(","),
		task.priority ?? 1,
		task.due?.date ?? "",
		// The human-readable rule ("every workday at 8:30 pm"). HabitDaily parses
		// its time out of this, which is why it is carried verbatim rather than
		// normalised here: the raw string is the evidence.
		task.due?.string ?? "",
		task.parent_id === undefined || task.parent_id === null
			? ""
			: String(task.parent_id),
	]);
}

export function planRecurringStatus(
	snapshot: RecurringStatusSnapshot,
	tab: string,
	today: DayKey,
): WritePlan {
	const rows = buildRecurringStatusRows(snapshot, today);

	return {
		// Replacing today's rows is what makes a re-run idempotent. Without it
		// a manual run after the nightly one would double every habit's row for
		// the day, and HabitDaily would read the day twice.
		writes: [
			replaceWhere(
				tab,
				SNAPSHOT_DATE_COLUMN,
				{ equals: today },
				rows,
			),
		],
		stateToPersist: {},
		logLines: [
			`RecurringStatus: ${rows.length} recurring task(s) on ${today}`,
		],
	};
}
