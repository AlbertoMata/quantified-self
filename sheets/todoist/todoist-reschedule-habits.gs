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

	// Only tasks that are genuinely skipped — see isStale().
	const stale = tasks.filter((t) => isStale(t, now));

	const commands = stale.map((t) => ({
		type: "item_update",
		uuid: Utilities.getUuid(),
		args: { id: String(t.id), due: nextOccurrenceDue(t) },
	}));

	// The timezone drives every comparison here; log it so a misconfigured Apps Script
	// project shows up as an obviously wrong clock rather than silently wrong dates.
	Logger.log(
		`Reschedule "${section.name}": moved ${commands.length} of ${tasks.length} tasks (${tasks.length - commands.length} not yet ${RESCHEDULE_GRACE_HOURS}h past due, or undated) — now ${now} / tz ${Session.getScriptTimeZone()}`,
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

// Build the new `due` object for a task. Keeps the original recurring `string` (so
// the schedule survives) and sets `date` to the next matching day at the same time.
function nextOccurrenceDue(task) {
	const d = task.due || {};
	const rawDate = d.date || "";
	const isWorkday = /workday/i.test(d.string || "");

	const target = isWorkday ? nextWeekday(new Date()) : addDays(new Date(), 1);
	const targetDate = localDateString(target);

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
