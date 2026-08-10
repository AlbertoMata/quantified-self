// ─────────────────────────────────────────────────────────────────────────────
// Todoist Action — Reschedule Habit Tasks to the Next Day
//
// Manual helpers (run "at will" from the Apps Script editor) that bump a Habits
// section's pending tasks to the next day when a routine got skipped. One entry
// point per section:
//   rescheduleMorningRoutine / rescheduleWorkDay / rescheduleEveningRoutine /
//   rescheduleDailyReminders  — plus rescheduleAllHabits() for all four.
//
// Scope:  only INCOMPLETE tasks whose scheduled time is already at least
//         RESCHEDULE_GRACE_HOURS in the past are moved. Tasks due later today, tasks
//         only mildly overdue, and tasks with no due date are left untouched.
// Target: the next MATCHING day — "every workday" tasks skip to the next weekday,
//         everything else goes to the next calendar day; the time-of-day is kept.
//
// Recurrence is preserved by going through the v1 Sync API (todoistSync) with an
// item_update whose `due` object retains the original recurring `string` and only
// sets a new `date`. A flat due_string/due_date update would re-anchor or drop the
// recurrence — this keeps the daily/workday schedule intact and just moves the next
// occurrence (the same thing Todoist's own "reschedule" does).
// ─────────────────────────────────────────────────────────────────────────────

const HABITS_PROJECT_NAME = "Habits";

// How far past its scheduled time a task must be before it counts as skipped. Comparing
// dates alone would treat an 8:30 am task as "due today" at 6 am and bump the whole routine
// to tomorrow before the day had even started.
const RESCHEDULE_GRACE_HOURS = 3;

// ── Public entry points ────────────────────────────────────────────────────────

function rescheduleMorningRoutine() {
	rescheduleHabitSection("Morning Routine");
}
function rescheduleWorkDay() {
	rescheduleHabitSection("Work Day");
}
function rescheduleEveningRoutine() {
	rescheduleHabitSection("Evening Routine");
}
function rescheduleDailyReminders() {
	rescheduleHabitSection("Daily Reminders");
}
function rescheduleAllHabits() {
	["Morning Routine", "Work Day", "Evening Routine", "Daily Reminders"].forEach(
		rescheduleHabitSection,
	);
}

// ── Core ────────────────────────────────────────────────────────────────────────

// Move the overdue/due-today tasks of one Habits section to their next matching day.
// plainName is the section name WITHOUT the emoji prefix (e.g. "Morning Routine");
// we match the live section by substring so the "🌅 " prefix doesn't matter.
function rescheduleHabitSection(plainName) {
	const projectId = getHabitsProjectId();
	if (!projectId) {
		Logger.log(`Reschedule: project "${HABITS_PROJECT_NAME}" not found`);
		return;
	}

	const section = findSectionByName(projectId, plainName);
	if (!section) {
		Logger.log(
			`Reschedule: section matching "${plainName}" not found in ${HABITS_PROJECT_NAME}`,
		);
		return;
	}

	const tasks = todoistGetPaged("/tasks", { section_id: String(section.id) });
	const now = new Date();

	// A habit and its sub-habits move as ONE unit. Judged individually they go stale on
	// different clocks — a parent due 07:50 is bumped once the grace window passes, while
	// its date-only steps aren't stale until the day itself flips. The steps would then sit
	// a day behind the routine they belong to and read as skipped in that night's Overdue
	// snapshot. So the parent decides, and its steps follow it.
	const byId = {};
	tasks.forEach((t) => {
		byId[String(t.id)] = t;
	});
	const parentIdOf = (t) => String(t.parent_id || t.parentId || "");

	const stepsByParent = {};
	tasks.filter((t) => parentIdOf(t) !== "").forEach((t) => {
		const p = parentIdOf(t);
		(stepsByParent[p] = stepsByParent[p] || []).push(t);
	});

	// Top-level tasks decide for themselves. So do steps whose parent lives outside this
	// section — nothing here can judge them, and stranding them on a stale date would be
	// worse than the old per-task behaviour.
	const leaders = tasks.filter(
		(t) => parentIdOf(t) === "" || !byId[parentIdOf(t)],
	);

	const commands = [];
	leaders.filter((t) => isStale(t, now)).forEach((t) => {
		const due = nextOccurrenceDue(t);
		commands.push(updateCommand(t, due));
		// Steps take the parent's target DATE but keep their own recurring string, so one
		// that repeats "every workday" stays a workday task while landing on the same day
		// as its routine. Undated steps are left alone — they were never scheduled, and
		// giving them a date here would silently opt them into the Overdue snapshot.
		(stepsByParent[String(t.id)] || [])
			.filter((s) => s.due && s.due.date)
			.forEach((s) => {
				commands.push(
					updateCommand(
						s,
						dueForDate(s, String(due.date).split("T")[0]),
					),
				);
			});
	});

	// A step can also fall behind without its parent ever going stale: do the routine but
	// leave one box unchecked, and Todoist rolls the PARENT forward on completion while the
	// step stays put. The parent is healthy, so nothing above would ever touch that step and
	// it stays overdue indefinitely. Catch any straggler up to wherever its parent now sits.
	const commanded = {};
	commands.forEach((c) => {
		commanded[c.args.id] = true;
	});
	tasks.forEach((t) => {
		const parent = byId[parentIdOf(t)];
		if (!parent || commanded[String(t.id)]) return;
		if (!t.due || !t.due.date || !parent.due || !parent.due.date) return;
		const stepDay = String(t.due.date).split("T")[0];
		const parentDay = String(parent.due.date).split("T")[0];
		if (stepDay < parentDay) {
			commands.push(updateCommand(t, dueForDate(t, parentDay)));
		}
	});

	// The timezone drives every comparison here; log it so a misconfigured Apps Script
	// project shows up as an obviously wrong clock rather than silently wrong dates.
	Logger.log(
		`Reschedule "${section.name}": moved ${commands.length} of ${tasks.length} tasks — ${leaders.length} judged directly (the rest are sub-habits, which follow their parent), skipping those not yet ${RESCHEDULE_GRACE_HOURS}h past due or undated — now ${now} / tz ${Session.getScriptTimeZone()}`,
	);

	if (commands.length === 0) return;
	todoistSync(commands);
}

// A task is only bumped once its scheduled time is at least RESCHEDULE_GRACE_HOURS in the
// past. Tasks due later today, tasks only mildly overdue, and undated tasks stay put.
function isStale(task, now) {
	const raw = task.due && task.due.date ? task.due.date : "";
	if (!raw) return false;
	// Date-only due: there is no clock time to be "hours behind", so it only goes stale once
	// the day itself has passed.
	if (raw.indexOf("T") === -1) return raw < localDateString(now);
	const dueAt = new Date(raw); // floating "…T05:10:00" → parsed in the script's timezone
	return (
		dueAt.getTime() <=
		now.getTime() - RESCHEDULE_GRACE_HOURS * 60 * 60 * 1000
	);
}

// Build the new `due` object for a task: its next matching day, at the same time.
function nextOccurrenceDue(task) {
	const d = task.due || {};
	const isWorkday = /workday/i.test(d.string || "");
	const target = isWorkday ? nextWeekday(new Date()) : addDays(new Date(), 1);
	return dueForDate(task, localDateString(target));
}

// Put `task` on targetDate (YYYY-MM-DD), keeping its time-of-day and its recurring
// `string` so the schedule survives the move. Split out from nextOccurrenceDue so a
// sub-habit can be moved to its PARENT's date while still carrying its own recurrence.
function dueForDate(task, targetDate) {
	const d = task.due || {};
	const rawDate = d.date || "";

	// Preserve the time-of-day if the original due carried one (datetime has a "T").
	const newDate = rawDate.indexOf("T") !== -1
		? `${targetDate}T${rawDate.split("T")[1]}`
		: targetDate;

	const isRecurring =
		d.is_recurring === true || (!!d.string && d.string !== "");
	return isRecurring
		? { string: d.string, date: newDate }
		: { date: newDate };
}

function updateCommand(task, due) {
	return {
		type: "item_update",
		uuid: Utilities.getUuid(),
		args: { id: String(task.id), due: due },
	};
}

// ── Lookups ──────────────────────────────────────────────────────────────────────

function getHabitsProjectId() {
	const projectMap = getProjectMap(); // id → name (cached)
	const entry = Object.entries(projectMap).find(
		([, name]) => name === HABITS_PROJECT_NAME,
	);
	return entry ? entry[0] : null;
}

function findSectionByName(projectId, plainName) {
	const sections = todoistGetPaged("/sections", {
		project_id: String(projectId),
	});
	return sections.find((s) => (s.name || "").indexOf(plainName) !== -1) || null;
}

// ── Date helpers ─────────────────────────────────────────────────────────────────

// The shared toDateString() formats via toISOString(), i.e. UTC. This file's comparisons are
// clock-sensitive, and in a UTC-behind timezone an evening run would read tomorrow's UTC date
// as "today" and land every task a day late — so format in the script's timezone instead.
function localDateString(date) {
	return Utilities.formatDate(
		date,
		Session.getScriptTimeZone(),
		"yyyy-MM-dd",
	);
}

// ISO day of week: 1 = Monday … 7 = Sunday.
function localDayOfWeek(date) {
	return Number(
		Utilities.formatDate(date, Session.getScriptTimeZone(), "u"),
	);
}

function addDays(date, days) {
	const copy = new Date(date.getTime());
	copy.setDate(copy.getDate() + days);
	return copy;
}

// Next calendar day, skipping Saturday (6) and Sunday (7).
function nextWeekday(date) {
	let next = addDays(date, 1);
	while (localDayOfWeek(next) >= 6) {
		next = addDays(next, 1);
	}
	return next;
}
