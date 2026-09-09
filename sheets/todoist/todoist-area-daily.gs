// ─────────────────────────────────────────────────────────────────────────────
// Todoist Sync — Area Daily Rollup
//
// The dense area × day grid behind the "am I lost?" question. One row per area per day,
// every day, whether or not anything happened — Looker has no cross join and no calendar
// generator, so a day with no activity has no row to render unless this tab supplies one.
//
// SECTION-AGNOSTIC BY CONSTRUCTION. Board vocabularies differ wildly across projects
// (`Study/Reading` has Backlog/In Progress/Quiz/Done, `Ascensus` swaps Done and Blocked,
// and `Bills`, `Finance`, `SAT`, `Challenger` and `Purchases` have no sections at all), so
// an area-level rollup cannot share one column vocabulary. It counts tasks, not columns.
//
// TWO KINDS OF COLUMN, and the difference is the honest part:
//   * `completed` derives from `Completions`, which reaches back to the beginning of the
//     sheet — so it is fully BACKFILLABLE.
//   * `open` / `overdue` / `in_week` / `p1_open` are SNAPSHOTS of a moment. Todoist keeps
//     no history of what was open on a past day, so these only ever accrue forward from
//     the day this tab starts running.
//
// `counts_observed` marks which of the two a row is. A backfilled row leaves the snapshot
// columns BLANK rather than zero — a zero would read as "nothing was open that day", which
// is a claim this tab is in no position to make.
// ─────────────────────────────────────────────────────────────────────────────

const AREA_DAILY_HEADER = [
	"snapshot_date", // A
	"area", // B
	"open", // C — snapshot only
	"overdue", // D — snapshot only
	"in_week", // E — snapshot only
	"p1_open", // F — snapshot only
	"completed", // G — derived from Completions, backfillable
	"counts_observed", // H — TRUE when C–F are real observations
];

// Every area gets a row every day, including `uncategorized`. Its count is a metric in its
// own right: a rising uncategorized line means the taxonomy is drifting.
function areaDailyAreas() {
	return AREA_ORDER.concat([AREA_UNCATEGORIZED]);
}

function syncAreaDaily() {
	const ss = SpreadsheetApp.openById(TODOIST_SPREADSHEET_ID);
	const sheet = getOrCreateAreaDailySheet(ss);
	const tree = getProjectTree();
	const today = localDateString(new Date());

	const tasks = todoistGetPaged("/tasks");
	const snap = {};
	areaDailyAreas().forEach((a) => {
		snap[a] = { open: 0, overdue: 0, in_week: 0, p1_open: 0 };
	});

	tasks.forEach((t) => {
		const pid = String(t.project_id || "");
		const area = areaOf(pid, t.labels || [], tree).area;
		const bucket =
			snap[area] ||
			(snap[area] = {
				open: 0,
				overdue: 0,
				in_week: 0,
				p1_open: 0,
			});
		bucket.open++;
		const due =
			t.due && t.due.date
				? String(t.due.date).slice(0, 10)
				: "";
		if (due) {
			const late = daysBetweenDays(due, today);
			if (late !== "" && late > 0) bucket.overdue++;
		}
		if (inWeekOf(pid)) bucket.in_week++;
		// Todoist's API numbers priority 4 = p1 (highest). The UI label and the wire
		// value run in opposite directions, which is an easy off-by-three.
		if (Number(t.priority) === 4) bucket.p1_open++;
	});

	const completed = completionCountsByDayArea(ss, tree);
	const todayCompleted = completed[today] || {};

	const rows = areaDailyAreas().map((area) => [
		today,
		area,
		snap[area].open,
		snap[area].overdue,
		snap[area].in_week,
		snap[area].p1_open,
		todayCompleted[area] || 0,
		"TRUE",
	]);

	replaceAreaDailyRows(sheet, today, rows);
	Logger.log(
		`AreaDaily: wrote ${rows.length} rows for ${today} from ${tasks.length} open tasks`,
	);
}

// Fills `completed` for every day the sheet has history for, leaving the snapshot columns
// blank. Safe to re-run: it never touches a row whose counts were actually observed.
function backfillAreaDaily() {
	const ss = SpreadsheetApp.openById(TODOIST_SPREADSHEET_ID);
	const sheet = getOrCreateAreaDailySheet(ss);
	const tree = getProjectTree();
	const today = localDateString(new Date());

	const observed = {};
	const lastRow = sheet.getLastRow();
	if (lastRow > 1) {
		sheet.getRange(2, 1, lastRow - 1, AREA_DAILY_HEADER.length)
			.getValues()
			.forEach((r) => {
				if (
					String(r[7] || "").toUpperCase() ===
					"TRUE"
				) {
					observed[
						`${dateKey(r[0]).slice(0, 10)}|${r[1]}`
					] = true;
				}
			});
	}

	const counts = completionCountsByDayArea(ss, tree);
	const days = Object.keys(counts).sort();
	const rows = [];
	days.forEach((day) => {
		if (day >= today) return; // today belongs to syncAreaDaily()
		areaDailyAreas().forEach((area) => {
			if (observed[`${day}|${area}`]) return;
			rows.push([
				day,
				area,
				"", // open — unknowable for a past day
				"", // overdue
				"", // in_week
				"", // p1_open
				(counts[day] || {})[area] || 0,
				"FALSE",
			]);
		});
	});

	if (rows.length === 0) {
		Logger.log("backfillAreaDaily: nothing to add");
		return;
	}
	// Sorted so the tab stays chronological after the append.
	rows.sort((a, b) =>
		a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1,
	);
	sheet.getRange(
		sheet.getLastRow() + 1,
		1,
		rows.length,
		AREA_DAILY_HEADER.length,
	).setValues(rows);
	Logger.log(
		`backfillAreaDaily: added ${rows.length} derived rows across ${days.length} days ` +
			"(snapshot columns left blank — those days were never observed)",
	);
}

// day → area → completion count, from `Completions`. Attribution is the LOCAL day of
// `completed_at`, the same rule HabitDaily uses, so the two tabs agree about which day a
// completion belongs to.
function completionCountsByDayArea(ss, tree) {
	const sheet = ss.getSheetByName("Completions");
	const out = {};
	if (!sheet || sheet.getLastRow() < 2) return out;
	const data = sheet.getDataRange().getValues();
	for (let i = 1; i < data.length; i++) {
		const day = localDayOf(data[i][0]);
		if (!day) continue;
		const stored = String(data[i][14] || "").trim();
		const area =
			stored ||
			areaOf(
				String(data[i][3] || ""),
				splitLabels(data[i][6]),
				tree,
			).area;
		out[day] = out[day] || {};
		out[day][area] = (out[day][area] || 0) + 1;
	}
	return out;
}

// Clear every row on or after `day`, then append. The `Overdue` idiom: re-running the
// hourly sync must refresh today rather than stack a second set of rows on top of it.
function replaceAreaDailyRows(sheet, day, rows) {
	const lastRow = sheet.getLastRow();
	if (lastRow > 1) {
		const dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
		let firstStale = -1;
		for (let i = 0; i < dates.length; i++) {
			if (dateKey(dates[i][0]).slice(0, 10) >= day) {
				firstStale = i + 2;
				break;
			}
		}
		if (firstStale > 0) {
			sheet.getRange(
				firstStale,
				1,
				lastRow - firstStale + 1,
				AREA_DAILY_HEADER.length,
			).clearContent();
		}
	}
	if (rows.length === 0) return;
	sheet.getRange(
		sheet.getLastRow() + 1,
		1,
		rows.length,
		rows[0].length,
	).setValues(rows);
}

function getOrCreateAreaDailySheet(ss) {
	let sheet = ss.getSheetByName("AreaDaily");
	if (!sheet) {
		sheet = ss.insertSheet("AreaDaily");
		sheet.getRange(1, 1, 1, AREA_DAILY_HEADER.length).setValues([
			AREA_DAILY_HEADER,
		]);
		return sheet;
	}
	const existing = sheet.getLastColumn()
		? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
		: [];
	if (existing.join("|") !== AREA_DAILY_HEADER.join("|")) {
		// Archive rather than clear: the snapshot columns are observations of days
		// that cannot be re-observed. Only `completed` could be rebuilt.
		return archiveAndRecreateSheet(
			ss,
			sheet,
			"AreaDaily",
			AREA_DAILY_HEADER,
		);
	}
	return sheet;
}
