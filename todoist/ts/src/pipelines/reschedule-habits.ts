// ─────────────────────────────────────────────────────────────────────────────
// Reschedule habits — THE ONLY WRITE PATH TO TODOIST IN THE WHOLE PROJECT
//
// Everything else reads Todoist and writes a spreadsheet. This changes Todoist
// itself, which makes it the one pipeline the `_port` shadow-tab scheme cannot
// protect: **there is no shadow Todoist**. A wrong plan here moves real tasks in
// the app you use every day.
//
// So the shape is deliberately different: the decision is a PURE function
// returning a list of commands, and issuing them is a separate step that has to
// be asked for. Reading the commands a run would send is always possible without
// sending them, and that is the whole safety model.
//
// WHAT IT DOES: bumps a Habits section's genuinely-skipped tasks to their next
// matching day. "Every workday" tasks skip the weekend; everything else moves one
// calendar day; the time of day is kept.
//
// RECURRENCE IS PRESERVED by going through the v1 Sync API with an `item_update`
// whose `due` object keeps the original recurring `string` and only sets a new
// `date`. A flat due_string/due_date update would RE-ANCHOR or drop the
// recurrence — this moves the next occurrence and nothing else, which is what
// Todoist's own reschedule does.
// ─────────────────────────────────────────────────────────────────────────────

import {
	addDaysToDay,
	formatDayInTimezone,
	type DayKey,
} from "../core/dates.ts";
import type { TodoistTask } from "../services/todoist/responses.ts";

// How far past its scheduled time a task must be before it counts as skipped.
//
// Comparing dates alone would treat an 8:30 am task as "due today" at 6 am and
// bump the whole routine to tomorrow before the day had even started.
export const RESCHEDULE_GRACE_HOURS = 3;

export const HABITS_PROJECT_NAME = "Habits";
export const HABIT_SECTIONS = [
	"Morning Routine",
	"Work Day",
	"Evening Routine",
	"Daily Reminders",
];

export interface TodoistDue {
	readonly date: string;
	readonly string?: string;
}

export interface UpdateCommand {
	readonly type: "item_update";
	readonly uuid: string;
	readonly args: { readonly id: string; readonly due: TodoistDue };
}

// Is this task far enough past its time to count as skipped?
//
// A DATE-ONLY due has no clock time to be "hours behind", so it only goes stale
// once the day itself has passed. A datetime is measured against the grace
// window. An undated task is never stale — it was never scheduled.
export function isStale(
	task: TodoistTask,
	now: Date,
	timezone: string,
): boolean {
	const raw = task.due?.date ?? "";
	if (!raw) return false;

	if (!raw.includes("T")) {
		return raw < formatDayInTimezone(now, timezone);
	}

	// A floating "…T05:10:00" carries no zone. Parsing it directly would read it
	// as UTC and make every morning habit look three hours less stale than it is
	// in a UTC-6 zone, so the offset is applied explicitly.
	const dueAt = parseFloatingLocal(raw, timezone);
	if (dueAt === null) return false;
	return (
		dueAt.getTime() <=
		now.getTime() - RESCHEDULE_GRACE_HOURS * 3_600_000
	);
}

// Interpret a floating datetime as an instant in `timezone`.
//
// Todoist sends "2026-09-14T05:10:00" with no offset, meaning 05:10 LOCAL. The
// offset is derived from the zone at that moment rather than assumed, so this
// stays correct if a zone ever reintroduces DST.
function parseFloatingLocal(raw: string, timezone: string): Date | null {
	const asUtc = new Date(`${raw}Z`);
	if (Number.isNaN(asUtc.getTime())) return null;

	// What wall-clock time does that instant show in the target zone? The
	// difference is the offset to undo.
	const shown = new Date(
		asUtc.toLocaleString("en-US", { timeZone: timezone }),
	);
	const reference = new Date(
		asUtc.toLocaleString("en-US", { timeZone: "UTC" }),
	);
	const offsetMs = shown.getTime() - reference.getTime();
	return new Date(asUtc.getTime() - offsetMs);
}

// The next day this task should land on.
//
// A "workday" rule skips the weekend; anything else moves one calendar day.
export function nextOccurrenceDay(task: TodoistTask, today: DayKey): DayKey {
	const isWorkday = /workday/i.test(task.due?.string ?? "");
	let target = addDaysToDay(today, 1);
	if (isWorkday) {
		while (isWeekend(target)) target = addDaysToDay(target, 1);
	}
	return target;
}

function isWeekend(day: DayKey): boolean {
	const dayOfWeek = new Date(`${day}T00:00:00Z`).getUTCDay();
	return dayOfWeek === 0 || dayOfWeek === 6;
}

// Put a task on `targetDay`, keeping its time of day AND its recurring string.
//
// Split out so a sub-habit can be moved to its PARENT's day while still carrying
// its own recurrence — one that repeats "every workday" stays a workday task
// while landing on the same day as its routine.
export function dueForDay(task: TodoistTask, targetDay: DayKey): TodoistDue {
	const raw = task.due?.date ?? "";
	const date = raw.includes("T")
		? `${targetDay}T${raw.split("T")[1] ?? ""}`
		: targetDay;

	const recurringString = task.due?.string ?? "";
	const isRecurring =
		task.due?.is_recurring === true || recurringString !== "";
	return isRecurring ? { string: recurringString, date } : { date };
}

export interface ReschedulePlan {
	readonly commands: readonly UpdateCommand[];
	readonly logLines: readonly string[];
}

// Work out what to move. PURE — it issues nothing.
//
// `newUuid` is injected rather than called, so a test sees stable command ids and
// the idempotency key stays a real dependency rather than an ambient one.
export function planHabitReschedule(
	sectionName: string,
	tasks: readonly TodoistTask[],
	now: Date,
	timezone: string,
	newUuid: () => string,
): ReschedulePlan {
	const today = formatDayInTimezone(now, timezone);
	const byId = new Map<string, TodoistTask>();
	for (const task of tasks) byId.set(String(task.id ?? ""), task);

	const parentIdOf = (task: TodoistTask): string =>
		task.parent_id === undefined || task.parent_id === null
			? ""
			: String(task.parent_id);

	const stepsByParent = new Map<string, TodoistTask[]>();
	for (const task of tasks) {
		const parentId = parentIdOf(task);
		if (!parentId) continue;
		const list = stepsByParent.get(parentId) ?? [];
		list.push(task);
		stepsByParent.set(parentId, list);
	}

	// A HABIT AND ITS SUB-HABITS MOVE AS ONE UNIT. Judged individually they go
	// stale on different clocks — a parent due 07:50 is bumped once the grace
	// window passes, while its date-only steps are not stale until the day
	// itself flips. The steps would then sit a day behind the routine they
	// belong to and read as skipped in that night's Overdue snapshot.
	//
	// Top-level tasks decide for themselves. So do steps whose parent lives
	// OUTSIDE this section — nothing here can judge them, and stranding them on
	// a stale date would be worse than moving them.
	const leaders = tasks.filter(
		(task) =>
			parentIdOf(task) === "" || !byId.has(parentIdOf(task)),
	);

	const commands: UpdateCommand[] = [];
	const commanded = new Set<string>();

	for (const leader of leaders) {
		if (!isStale(leader, now, timezone)) continue;

		const targetDay = nextOccurrenceDay(leader, today);
		commands.push(
			updateCommand(
				leader,
				dueForDay(leader, targetDay),
				newUuid,
			),
		);
		commanded.add(String(leader.id ?? ""));

		// Steps take the parent's target DAY but keep their own recurrence.
		// UNDATED steps are left alone — they were never scheduled, and giving
		// them a date here would silently opt them into the Overdue snapshot.
		for (const step of stepsByParent.get(String(leader.id ?? "")) ??
			[]) {
			if (!step.due?.date) continue;
			commands.push(
				updateCommand(
					step,
					dueForDay(step, targetDay),
					newUuid,
				),
			);
			commanded.add(String(step.id ?? ""));
		}
	}

	// A STEP CAN FALL BEHIND WITHOUT ITS PARENT EVER GOING STALE: do the routine
	// but leave one box unchecked, and Todoist rolls the PARENT forward on
	// completion while the step stays put. The parent is healthy, so nothing
	// above would ever touch that step and it stays overdue indefinitely.
	for (const task of tasks) {
		const parent = byId.get(parentIdOf(task));
		if (!parent || commanded.has(String(task.id ?? ""))) continue;
		if (!task.due?.date || !parent.due?.date) continue;

		const stepDay = task.due.date.split("T")[0] ?? "";
		const parentDay = parent.due.date.split("T")[0] ?? "";
		if (stepDay < parentDay) {
			commands.push(
				updateCommand(
					task,
					dueForDay(task, parentDay),
					newUuid,
				),
			);
		}
	}

	return {
		commands,
		logLines: [
			`Reschedule "${sectionName}": ${commands.length} of ${tasks.length} task(s) ` +
				`would move — ${leaders.length} judged directly (the rest are sub-habits ` +
				`that follow their parent), skipping anything under ${RESCHEDULE_GRACE_HOURS}h ` +
				`past due or undated. Today is ${today} in ${timezone}`,
			...commands.map(
				(command) =>
					`  ${command.args.id} → ${command.args.due.date}` +
					(command.args.due.string
						? ` (${command.args.due.string})`
						: ""),
			),
		],
	};
}

// Todoist's /sync uses the uuid for IDEMPOTENCY: replaying a command with the
// same uuid is a no-op rather than a second write. That is what stands between a
// retried run and a double reschedule.
function updateCommand(
	task: TodoistTask,
	due: TodoistDue,
	newUuid: () => string,
): UpdateCommand {
	return {
		type: "item_update",
		uuid: newUuid(),
		args: { id: String(task.id ?? ""), due },
	};
}
