// ─────────────────────────────────────────────────────────────────────────────
// Todoist Sync — Habit Daily Grid
//
// Builds the DENSE habit × day grid that Looker Studio cannot build for itself.
// `Completions` is an event log: it only ever contains the days a habit WAS done,
// and Looker has no cross join and no calendar generator, so the days a habit was
// MISSED simply have no row to render. This tab supplies them.
//
// Source: the nightly path makes no API calls — everything it needs is already in the
// spreadsheet (the one-time synthesizeHabitDailyHistory() is the exception; see below):
//   * `RecurringStatus` is the SPINE. It writes one row per active recurring task
//     every night whether or not the task was completed, so it already answers
//     "did this habit exist on day D, and was it still pending at 23:30".
//   * `Completions` is the TRUTH for whether it was checked off. It has to be:
//     RecurringStatus alone cannot tell a completion from a bump by
//     todoist-reschedule-habits.gs, because both advance due_date.
//
// Being sheet-to-sheet makes this idempotent and self-healing: every run REBUILDS
// its window from scratch rather than appending, so a late completion, a corrected
// row upstream, or a re-run all converge on the same answer. syncHabitDaily() does
// the last HABIT_DAILY_WINDOW_DAYS days nightly; backfillHabitDaily() does the whole
// history through the identical code path, so there is no seam between them.
//
// Attribution: a completion counts on the LOCAL day it was checked off, derived from
// `completed_at` in the script's timezone. The alternative — the occurrence it settled
// (`due_date`) — is wrong for a grid that answers "on which days did I actually do
// this", and column J carries the pre-fix off-by-one-occurrence values for every row
// written before the completed_due_date fix shipped. completed_at has always been
// correct, so the grid is built on it and needs no backfill caveat.
//
// Known blind spot: if todoist-reschedule-habits.gs bumps a skipped habit forward
// BEFORE the 23:30 snapshot, that day's spine row shows due_date in the future and the
// day reads "not_due" rather than "missed". It fails safe — a miss is dropped, never a
// completion invented — but a routine you reschedule habitually will flatter itself.
//
// Weekend policy: Saturdays and Sundays are REST DAYS across ALL history. An uncompleted
// weekend day reads "not_due", never "missed"; a weekend check-off still counts as "done"
// (with due = 1). This deliberately reinterprets the past — the habits ran "every day"
// until 2026-08-20, when everything switched to "every workday", and the owner's call is
// that weekends were never part of the contract. Anything that ever synthesises a
// pre-2026-08-10 spine must apply this same rule rather than trusting the historical
// "every day" recurrence strings.
//
// Habit naming: column C holds a SHORT name — everything before the first " - " in the
// Todoist title. Half the habits carry a motivational tagline ("Drink Water - Drink water
// early in the morning to start fresh") and half do not, which makes the Looker row labels
// a mix of phrases and sentences. Deriving the short name here rather than renaming the
// tasks keeps Todoist untouched and avoids fighting the Habit Tracker app over titles. The
// untrimmed title is kept in column D so nothing is lost.
//
// Sheet layout (HabitDaily):
//   A: date  B: task_id  C: habit  D: habit_full  E: section_name  F: labels
//   G: status  H: completed  I: due  J: completed_at  K: due_date  L: priority
//   M: recurrence_string  N: sync_date
//
// Changing this layout invalidates existing rows, so getOrCreateHabitDailySheet() clears
// the tab when it finds an old header rather than writing new columns over stale ones.
// ─────────────────────────────────────────────────────────────────────────────

// The label that marks a tracked habit. Matched as an exact token, never a substring:
// `sub-habits` contains "habits" and would otherwise sweep every checklist step in.
const HABITS_LABEL = "habits";

// How many days back the nightly run rebuilds. One day would be enough for the common
// case, but a habit checked off between the 23:30 sync and midnight lands in the next
// day's data — a window wider than a day is what lets the following run correct it.
const HABIT_DAILY_WINDOW_DAYS = 7;

// Window for a from-scratch rebuild. Deliberately wider than the Completions sheet's
// 90-day API reach: the spine goes back further, and a spine row with no matching
// completion is exactly what "missed" looks like. rebuildHabitDaily() falls back to this
// span on its own whenever the tab is empty — fresh deploy, layout-change clear, or a
// manual wipe — so the nightly 7-day window can never truncate history to a week.
const HABIT_DAILY_BACKFILL_DAYS = 400;

const HABIT_DAILY_HEADER = [
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
];

// ── Public entry points ────────────────────────────────────────────────────────

// Nightly. Registered in syncTodoist() AFTER RecurringStatus, which is the spine it
// reads — running it earlier would rebuild today's grid from a spine missing today.
function syncHabitDaily() {
	rebuildHabitDaily(HABIT_DAILY_WINDOW_DAYS);
}

// One-time (or whenever you want the whole grid recomputed) — e.g. after changing how
// status is derived. Rarely needed by hand: an empty tab triggers the same full span
// automatically (see HABIT_DAILY_BACKFILL_DAYS).
function backfillHabitDaily() {
	rebuildHabitDaily(HABIT_DAILY_BACKFILL_DAYS);
}

// Report how far back each source actually reaches. HabitDaily can never start earlier
// than its spine, so when the grid looks short this is the function that says why: either
// RecurringStatus has no snapshots that far back, or the snapshots it has do not carry the
// `habits` label. Run it from the editor and read the log — it writes nothing.
function diagnoseHabitDailySources() {
	const ss = SpreadsheetApp.openById(TODOIST_SPREADSHEET_ID);

	["Completions", "RecurringStatus", "Overdue", "HabitDaily"].forEach((name) => {
		const sheet = ss.getSheetByName(name);
		if (!sheet) {
			Logger.log(`${name}: tab does not exist`);
			return;
		}
		const rows = Math.max(0, sheet.getLastRow() - 1);
		if (rows === 0) {
			Logger.log(`${name}: 0 data rows`);
			return;
		}
		const dates = sheet
			.getRange(2, 1, rows, 1)
			.getValues()
			.map((r) => dateKey(r[0]).slice(0, 10))
			.filter((d) => d !== "");
		dates.sort();
		Logger.log(
			`${name}: ${rows} rows, ${dates[0]} → ${dates[dates.length - 1]}`,
		);
	});

	// The spine is what caps the grid, so break it down by label and by habit.
	const spineSheet = ss.getSheetByName("RecurringStatus");
	if (!spineSheet || spineSheet.getLastRow() < 2) return;
	const data = spineSheet.getDataRange().getValues();
	let tagged = 0;
	const days = {};
	const habits = {};
	for (let i = 1; i < data.length; i++) {
		if (!hasLabel(splitLabels(data[i][5]), HABITS_LABEL)) continue;
		tagged++;
		days[dateKey(data[i][0])] = true;
		habits[String(data[i][1] || "")] = String(data[i][2] || "");
	}
	const dayList = Object.keys(days).sort();
	Logger.log(
		`RecurringStatus rows carrying "${HABITS_LABEL}": ${tagged} of ${data.length - 1}, ` +
			`covering ${dayList.length} distinct days (${dayList[0]} → ${dayList[dayList.length - 1]}) ` +
			`across ${Object.keys(habits).length} habits`,
	);
	Logger.log(
		`Earliest day HabitDaily can reach: ${dayList[0] || "n/a"} — anything before this needs a synthesised spine`,
	);
}

// ── One-time history synthesis ──────────────────────────────────────────────────
//
// The spine only exists from the day syncRecurringStatus first ran (2026-08-10), but
// Completions reaches months further back. This reconstructs the pre-spine grid from
// each habit's existence instead of from observations:
//
//   * A habit's synthetic window starts at max(its Todoist added_at, its FIRST captured
//     completion) and ends the day before the observed spine begins. The first-completion
//     floor is the honesty guard: recurring check-offs were only captured from some point
//     on, and synthesising days before a habit ever shows up in Completions would paint
//     every uncaptured day as "missed" — streak poison. The tradeoff is deliberate
//     undercounting: a habit that existed but was never once captured is skipped
//     entirely (which also keeps out tasks that carry `habits` today but were plain
//     reminders back then).
//   * Weekday due-ness comes from the rest-day contract, not from recurrence strings —
//     the same weekend policy the observed grid applies.
//   * due_date (col K) is left BLANK on synthetic rows: no snapshot existed, and an
//     empty cell is the honest marker that distinguishes them from observed rows.
//   * section/labels/priority/recurrence are the habit's CURRENT values — the past ones
//     are unknowable. Close enough for grouping; documented in the schema.
//
// Idempotent: a previous synthetic block (the contiguous rows above the observed spine
// start) is removed and rewritten. Safe to re-run after Completions grows.
function synthesizeHabitDailyHistory() {
	const ss = SpreadsheetApp.openById(TODOIST_SPREADSHEET_ID);
	const spineSheet = ss.getSheetByName("RecurringStatus");
	const sheet = ss.getSheetByName("HabitDaily");
	if (!spineSheet || !sheet || sheet.getLastRow() < 2) {
		Logger.log(
			"Synthesize: needs RecurringStatus and a populated HabitDaily — run syncTodoist() (or backfillHabitDaily()) first.",
		);
		return;
	}

	const spineStart = earliestSpineHabitDay(spineSheet);
	if (!spineStart) {
		Logger.log("Synthesize: RecurringStatus has no habit rows to anchor on.");
		return;
	}
	const synthEnd = calendarAddDays(spineStart, -1);

	const completed = buildCompletionIndex(ss);

	// First captured completion per habit — the per-habit honesty floor.
	const firstDone = {};
	Object.keys(completed).forEach((key) => {
		const sep = key.lastIndexOf("|");
		const id = key.slice(0, sep);
		const day = key.slice(sep + 1);
		if (!firstDone[id] || day < firstDone[id]) firstDone[id] = day;
	});

	const habits = fetchLiveHabits();
	const today = localDateString(new Date());
	const rows = [];
	const skipped = [];
	habits.forEach((h) => {
		const floor =
			firstDone[h.id] && firstDone[h.id] > h.addedDay
				? firstDone[h.id]
				: h.addedDay;
		if (!firstDone[h.id] || !floor || floor > synthEnd) {
			skipped.push(h.content);
			return;
		}
		for (let d = floor; d <= synthEnd; d = calendarAddDays(d, 1)) {
			const key = `${h.id}|${d}`;
			const wasCompleted = Object.prototype.hasOwnProperty.call(
				completed,
				key,
			);
			const wasDue = !isRestDay(d) || wasCompleted;
			rows.push([
				d,
				h.id,
				shortHabitName(h.content),
				h.content,
				h.sectionName,
				h.labels.join(","),
				wasCompleted ? "done" : wasDue ? "missed" : "not_due",
				wasCompleted ? 1 : 0,
				wasDue ? 1 : 0,
				wasCompleted ? completed[key] : "",
				"", // due_date: no snapshot existed — blank marks the row as synthetic
				h.priority,
				h.recurrence,
				today,
			]);
		}
	});
	rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

	// Remove a previous synthetic block: the contiguous run of rows above the observed
	// spine start. Observed rows stay below, so this deleteRows never touches the last
	// movable row even on a frozen-header sheet.
	const lastRow = sheet.getLastRow();
	const dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
	let prevBlock = 0;
	while (
		prevBlock < dates.length &&
		dateKey(dates[prevBlock][0]) < spineStart
	) {
		prevBlock++;
	}
	if (prevBlock > 0) sheet.deleteRows(2, prevBlock);

	if (rows.length === 0) {
		Logger.log(
			`Synthesize: nothing to write — no habit has a captured completion before ${spineStart}. Skipped: ${skipped.join(", ")}`,
		);
		return;
	}
	sheet.insertRowsBefore(2, rows.length);
	sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);

	// Per-month done counts make capture gaps visible: a month with habits but ~zero
	// dones almost certainly predates completion capture, not your discipline.
	const byMonth = {};
	rows.forEach((r) => {
		const m = String(r[0]).slice(0, 7);
		byMonth[m] = byMonth[m] || { done: 0, rows: 0 };
		byMonth[m].rows++;
		if (r[6] === "done") byMonth[m].done++;
	});
	Logger.log(
		`Synthesize: wrote ${rows.length} rows (${rows[0][0]} → ${synthEnd}) for ${habits.length - skipped.length} habits; ` +
			`skipped ${skipped.length} with no captured pre-spine completion${skipped.length ? ` (${skipped.join(", ")})` : ""}`,
	);
	Object.keys(byMonth)
		.sort()
		.forEach((m) => {
			Logger.log(
				`  ${m}: ${byMonth[m].done} done of ${byMonth[m].rows} rows`,
			);
		});
}

// Earliest snapshot day carrying the habits label — where observation begins.
function earliestSpineHabitDay(spineSheet) {
	const data = spineSheet.getDataRange().getValues();
	let min = "";
	for (let i = 1; i < data.length; i++) {
		if (!hasLabel(splitLabels(data[i][5]), HABITS_LABEL)) continue;
		const d = dateKey(data[i][0]);
		if (d && (min === "" || d < min)) min = d;
	}
	return min;
}

// Live habit list straight from Todoist — the only place added_at lives. One paged
// filter query; the 6h-cached section map resolves names.
function fetchLiveHabits() {
	const tasks = todoistGetPaged("/tasks/filter", {
		query: `@${HABITS_LABEL}`,
	});
	const sectionMap = getSectionMap();
	return tasks.map((t) => {
		const sectionId = t.section_id || t.sectionId || null;
		return {
			id: String(t.id),
			content: t.content || "",
			sectionName: sectionId
				? sectionMap[String(sectionId)] || ""
				: "",
			labels: Array.isArray(t.labels) ? t.labels : [],
			priority: t.priority || 1,
			recurrence: t.due ? t.due.string || "" : "",
			addedDay: localDayOf(t.added_at || t.addedAt || ""),
		};
	});
}

// Calendar-date arithmetic on "YYYY-MM-DD" strings, UTC-anchored for the same reason as
// isRestDay(): a bare date has no timezone, so treating it as UTC end-to-end is exact.
function calendarAddDays(dateStr, days) {
	const d = new Date(`${dateStr}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().split("T")[0];
}

// ── Core ────────────────────────────────────────────────────────────────────────

// Rebuild the last `days` days of the grid. Rows for those dates are replaced, not
// appended, so this is safe to run repeatedly.
function rebuildHabitDaily(days) {
	const ss = SpreadsheetApp.openById(TODOIST_SPREADSHEET_ID);

	// Check the spine BEFORE creating the tab: bailing after getOrCreateHabitDailySheet()
	// would leave an empty HabitDaily behind that nothing ever fills.
	const spineSheet = ss.getSheetByName("RecurringStatus");
	if (!spineSheet) {
		Logger.log(
			"HabitDaily: no RecurringStatus tab — nothing to build the grid from. " +
				"Run syncRecurringStatus() at least once first.",
		);
		return;
	}

	const sheet = getOrCreateHabitDailySheet(ss);

	// An empty tab — fresh deploy, a layout-change clear (see getOrCreateHabitDailySheet),
	// or a manual wipe — gets the FULL span regardless of the window asked for. Without
	// this, the first nightly run after a layout change would clear the whole grid and
	// refill only a week. Same idiom as syncCompletions' empty-sheet auto-backfill.
	if (sheet.getLastRow() < 2 && days < HABIT_DAILY_BACKFILL_DAYS) {
		Logger.log(
			`HabitDaily: tab is empty — widening window ${days} → ${HABIT_DAILY_BACKFILL_DAYS} days (auto-backfill)`,
		);
		days = HABIT_DAILY_BACKFILL_DAYS;
	}

	const today = localDateString(new Date());
	const cutoff = localDateString(addDays(new Date(), -days));

	const completed = buildCompletionIndex(ss);
	const spine = readHabitSpine(spineSheet, cutoff, today);

	// Never let the replace reach below the observed spine: rebuild can only regenerate
	// days the spine has, so a 400-day cutoff would DELETE the synthesized pre-spine rows
	// (see synthesizeHabitDailyHistory) while writing nothing in their place. Clamping the
	// replace boundary to the earliest spine day leaves that block untouched.
	let replaceCutoff = cutoff;
	if (spine.length > 0) {
		const earliest = spine.reduce(
			(m, s) => (s.date < m ? s.date : m),
			spine[0].date,
		);
		if (earliest > replaceCutoff) replaceCutoff = earliest;
	}

	const rows = spine.map((s) => {
		const key = `${s.taskId}|${s.date}`;
		const wasCompleted = Object.prototype.hasOwnProperty.call(completed, key);
		// Scheduled that day if it was still pending at snapshot time AND the day is a
		// weekday — weekends are rest days by policy (see header), so a Saturday skip is
		// not a miss. The completion clause then does two jobs: a weekend check-off still
		// counts as done (with due = 1), and on weekdays it keeps a habit you actually did
		// from reading "not scheduled" just because completing it pushed due_date past
		// the day.
		const scheduled =
			s.dueDate !== "" && s.dueDate <= s.date && !isRestDay(s.date);
		const wasDue = scheduled || wasCompleted;
		return [
			s.date,
			s.taskId,
			shortHabitName(s.content),
			s.content,
			s.sectionName,
			s.labels.join(","),
			wasCompleted ? "done" : wasDue ? "missed" : "not_due",
			wasCompleted ? 1 : 0,
			wasDue ? 1 : 0,
			wasCompleted ? completed[key] : "",
			s.dueDate,
			s.priority,
			s.recurrence,
			today,
		];
	});

	replaceHabitDailyRows(sheet, replaceCutoff, rows);

	const done = rows.filter((r) => r[6] === "done").length;
	const missed = rows.filter((r) => r[6] === "missed").length;
	Logger.log(
		`HabitDaily: rebuilt ${rows.length} rows since ${cutoff} — ${done} done, ${missed} missed, ` +
			`${rows.length - done - missed} not due (tz ${Session.getScriptTimeZone()})`,
	);
}

// ── Reading the sources ─────────────────────────────────────────────────────────

// The spine: every nightly RecurringStatus snapshot of a task carrying the `habits`
// label, from `cutoff` onward. One entry per (habit, day) — including the days it was
// skipped, which is the entire point of reading this tab instead of Completions.
//
// Rows labeled AFTER `today` are skipped: a snapshot cannot observe a day that has not
// happened, so a future label is always a stamping artifact (syncRecurringStatus used to
// format "today" in UTC, which after 18:00 local is already tomorrow). Rendering one
// would show tomorrow's habits as pre-emptively missed.
function readHabitSpine(spineSheet, cutoff, today) {
	const data = spineSheet.getDataRange().getValues();
	const out = [];
	for (let i = 1; i < data.length; i++) {
		const r = data[i];
		const date = dateKey(r[0]);
		if (!date || date < cutoff || date > today) continue;
		const labels = splitLabels(r[5]);
		if (!hasLabel(labels, HABITS_LABEL)) continue;
		out.push({
			date: date,
			taskId: String(r[1] || ""),
			content: String(r[2] || ""),
			sectionName: String(r[4] || ""),
			labels: labels,
			priority: r[6] || 1,
			dueDate: dateKey(r[7]),
			recurrence: String(r[8] || ""),
		});
	}
	return out;
}

// Truth: which (habit, local day) pairs were actually checked off. Keyed on the LOCAL
// date of completed_at — see the file header for why not due_date.
function buildCompletionIndex(ss) {
	const sheet = ss.getSheetByName("Completions");
	if (!sheet) {
		Logger.log(
			"HabitDaily: no Completions tab — every habit day will read as missed.",
		);
		return {};
	}
	const data = sheet.getDataRange().getValues();
	const index = {};
	for (let i = 1; i < data.length; i++) {
		const r = data[i];
		if (String(r[8]).toUpperCase() !== "TRUE") continue; // is_recurring
		if (!hasLabel(splitLabels(r[6]), HABITS_LABEL)) continue;
		const day = localDayOf(r[0]);
		if (!day) continue;
		// Value is the local clock time, not a bare flag — "done at 05:22" is worth having,
		// and presence is tested with hasOwnProperty so an empty string still counts as done.
		index[`${String(r[1] || "")}|${day}`] = localTimeOf(r[0]);
	}
	return index;
}

// ── Writing ─────────────────────────────────────────────────────────────────────

function getOrCreateHabitDailySheet(ss) {
	let sheet = ss.getSheetByName("HabitDaily");
	if (!sheet) {
		sheet = ss.insertSheet("HabitDaily");
		writeHabitDailyHeader(sheet);
		return sheet;
	}
	// An older layout means every existing row is misaligned against the current columns.
	// Writing the new header over them would leave silently wrong data, so wipe instead —
	// the grid is derived, so nothing is lost that backfillHabitDaily() cannot rebuild.
	const width = HABIT_DAILY_HEADER.length;
	const existing = sheet.getLastColumn()
		? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
		: [];
	if (existing.join("|") !== HABIT_DAILY_HEADER.join("|")) {
		Logger.log(
			`HabitDaily: layout changed (${existing.length} cols → ${width}); clearing the tab. ` +
				"Run backfillHabitDaily() to refill the full history.",
		);
		sheet.clear();
		writeHabitDailyHeader(sheet);
	}
	return sheet;
}

function writeHabitDailyHeader(sheet) {
	sheet
		.getRange(1, 1, 1, HABIT_DAILY_HEADER.length)
		.setValues([HABIT_DAILY_HEADER]);
}

// Wipe every row on or after `cutoff`, then write the freshly computed ones. Two
// deliberate choices:
//   * One contiguous range op, not row-by-row — a 400-day backfill spans thousands of
//     rows, and per-row calls are what turn that into a timeout.
//   * clearContent(), NOT deleteRows() — a full-window rebuild makes EVERY data row
//     stale, and Sheets refuses to delete all unfrozen rows ("No puedes borrar todas
//     las filas móviles") the moment the header row is frozen, which it is the instant
//     someone freezes it by hand or converts the tab to a table. Clearing leaves the
//     grid rows in place and the rewrite lands right back on top of them.
function replaceHabitDailyRows(sheet, cutoff, rows) {
	const lastRow = sheet.getLastRow();
	if (lastRow > 1) {
		const dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
		let firstStale = -1;
		for (let i = 0; i < dates.length; i++) {
			if (dateKey(dates[i][0]) >= cutoff) {
				firstStale = i + 2;
				break;
			}
		}
		// Rows are appended in date order, so everything from the first in-window row
		// down is in the window; clearing through lastRow leaves nothing stale behind.
		if (firstStale > 0) {
			sheet
				.getRange(
					firstStale,
					1,
					lastRow - firstStale + 1,
					sheet.getLastColumn(),
				)
				.clearContent();
		}
	}
	if (rows.length === 0) return;
	sheet
		.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length)
		.setValues(rows);
}

// ── Small helpers ───────────────────────────────────────────────────────────────

function splitLabels(cell) {
	return String(cell || "")
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s !== "");
}

function hasLabel(labels, label) {
	return labels.indexOf(label) !== -1;
}

// "Drink Water - Drink water early in the morning to start fresh" → "Drink Water".
// Splits on the first " - " only, and only when the hyphen is surrounded by whitespace, so
// a genuinely hyphenated title ("Work-life balance") is left alone. Titles with no
// separator pass through unchanged.
function shortHabitName(content) {
	const text = String(content || "").trim();
	const match = text.match(/^(.*?)\s+-\s+/);
	return match ? match[1].trim() : text;
}

// The local clock time of a completion, "HH:mm". Same timezone reasoning as localDayOf().
function localTimeOf(cellValue) {
	if (!cellValue) return "";
	const d = cellValue instanceof Date ? cellValue : new Date(String(cellValue));
	if (isNaN(d.getTime())) return "";
	return Utilities.formatDate(d, Session.getScriptTimeZone(), "HH:mm");
}

// Saturday/Sunday test for a plain "YYYY-MM-DD" calendar date. Anchored to UTC on
// purpose: new Date("2026-08-15") parses as UTC midnight, so formatting it in this
// script's UTC-behind timezone (the localDayOfWeek() route) would read every Saturday
// as a Friday. A bare calendar string has a timezone-free weekday — read it back in UTC.
function isRestDay(dateStr) {
	const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0 = Sunday, 6 = Saturday
	return dow === 0 || dow === 6;
}

// completed_at as a YYYY-MM-DD in the SCRIPT's timezone. The stored value is UTC, so a
// habit checked off at 20:00 in a UTC-6 zone is stored on the following UTC date —
// formatting it as UTC would file every evening habit one day late.
function localDayOf(cellValue) {
	if (!cellValue) return "";
	const d = cellValue instanceof Date ? cellValue : new Date(String(cellValue));
	if (isNaN(d.getTime())) return "";
	return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
}
