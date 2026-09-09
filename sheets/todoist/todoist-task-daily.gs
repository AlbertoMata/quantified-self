// ─────────────────────────────────────────────────────────────────────────────
// Todoist Sync — Task Daily Snapshot
//
// One row per open task per day: the card-level companion to `AreaDaily`'s counts, and
// what answers "what has been sitting longest" for errands and "where is the work stuck"
// for work.
//
// Area-aware from birth rather than board-shaped and retrofitted. Most errand projects
// have no sections at all, so a board-shaped tab was the wrong container — but the four
// mechanisms below came out of the board design and are kept because they were right.
//
// 1. FOUR-CASE SECTION SEEDING. Section age needs a start date, and Todoist does not
//    record when a task entered a section — `item:updated` events carry no `section_id`,
//    so this can only ever be observed forward. The four cases:
//      * prior row, same section     → carry the existing date (exact)
//      * prior row, different section → an observed move: today (exact)
//      * no prior row, birth section → seed at `added_on` (a task starts in Backlog)
//      * no prior row, anywhere else → seed at today (a FLOOR, not a measurement)
//    `section_age_seeded` marks the seeded ones and is carried for the life of the task,
//    so a floor is never averaged in as though it were an observation.
//
// 2. EXIT ROWS. One terminal row for a task present yesterday and gone today, carrying its
//    last observed section — otherwise a completed task simply vanishes and nothing records
//    how long it took. The prior-state read MUST exclude `is_exit` rows, or a departed task
//    emits a fresh exit row every night forever.
//
// 3. STRICTLY-BEFORE PRIOR STATE. The prior snapshot is the last day *before* today, never
//    today's own half-written rows. Reading today's would reset every age to zero on the
//    second run of the day, and the intraday trigger runs hourly.
//
// 4. ARCHIVE, NEVER CLEAR. These rows are observed, not derived. Nothing can re-fetch what
//    was open last Tuesday, so an incompatible layout change archives the tab.
//
// SIZE. ~200 open tasks × 22 columns × 365 days ≈ 1.6M cells a year, against a 10M-cell
// limit shared by EVERY tab in this spreadsheet. Fine for two to three years, then it is
// not. `pruneTaskDaily()` exists for that day and is deliberately MANUAL — silently
// deleting observations that cannot be rebuilt is not something a nightly trigger should
// do. The sync warns as the ceiling approaches.
// ─────────────────────────────────────────────────────────────────────────────

const TASK_DAILY_HEADER = [
	"snapshot_date", // A
	"task_id", // B
	"content", // C
	"project_name", // D
	"area", // E
	"area_source", // F
	"in_week", // G
	"section_name", // H — blank where the project has no sections
	"work_stage", // I — normalised across incompatible vocabularies
	"labels", // J
	"priority", // K — API scale: 4 = p1 (highest)
	"due_date", // L
	"deadline_date", // M — a fossil on recurring tasks; see the contract
	"is_recurring", // N
	"is_subtask", // O
	"added_on", // P
	"days_in_project", // Q
	"section_entered_on", // R
	"days_in_section", // S
	"section_age_seeded", // T — TRUE when R is a floor, not an observation
	"days_overdue", // U — blank unless actually overdue
	"is_exit", // V — TRUE on the terminal row for a departed task
];

// Warn once the tab is using a meaningful share of the spreadsheet's 10M-cell budget.
const TASK_DAILY_CELL_WARNING = 4000000;

// Sections a task is BORN into. Only these justify back-dating section age to `added_on`;
// anywhere else, the honest answer is "no earlier than today".
const TASK_DAILY_BIRTH_STAGES = ["backlog"];

function syncTaskDaily() {
	const ss = SpreadsheetApp.openById(TODOIST_SPREADSHEET_ID);
	const sheet = getOrCreateTaskDailySheet(ss);
	const tree = getProjectTree();
	const sectionMap = getSectionMap();
	const today = localDateString(new Date());

	const tasks = todoistGetPaged("/tasks");
	const prior = readPriorTaskState(sheet, today);
	const rows = buildTaskDailyRows(tasks, prior, tree, sectionMap, today);

	replaceTaskDailyRows(sheet, today, rows);

	const cells = sheet.getLastRow() * TASK_DAILY_HEADER.length;
	if (cells > TASK_DAILY_CELL_WARNING) {
		Logger.log(
			`TaskDaily: ~${cells} cells and growing, against a 10M limit shared by every tab ` +
				"in this spreadsheet. Decide on a retention rule — pruneTaskDaily() or a " +
				"separate spreadsheet — before it becomes urgent.",
		);
	}
	Logger.log(
		`TaskDaily: ${rows.length} rows for ${today} (${tasks.length} open, ` +
			`${rows.filter((r) => r[21] === "TRUE").length} exits)`,
	);
}

function buildTaskDailyRows(tasks, prior, tree, sectionMap, today) {
	const rows = [];
	const seen = {};

	(tasks || []).forEach((t) => {
		const id = String(t.id);
		seen[id] = true;
		const pid = String(t.project_id || "");
		const resolved = areaOf(pid, t.labels || [], tree);
		const sectionName = t.section_id
			? sectionMap[String(t.section_id)] || ""
			: "";
		const stage = workStageOf(sectionName);
		const addedOn = String(t.added_at || t.addedAt || "").slice(
			0,
			10,
		);
		const due =
			t.due && t.due.date
				? String(t.due.date).slice(0, 10)
				: "";
		const deadline =
			t.deadline && t.deadline.date
				? String(t.deadline.date).slice(0, 10)
				: "";

		const age = sectionAgeFor(
			prior[id],
			sectionName,
			stage,
			addedOn,
			today,
		);
		const overdue = due ? daysBetweenDays(due, today) : "";

		rows.push([
			today,
			id,
			t.content || "",
			(tree[pid] && tree[pid].name) || "",
			resolved.area,
			resolved.source,
			inWeekOf(pid) ? "TRUE" : "FALSE",
			sectionName,
			stage,
			(t.labels || []).join(","),
			t.priority || 1,
			due,
			deadline,
			t.due && t.due.is_recurring ? "TRUE" : "FALSE",
			t.parent_id || t.parentId ? "TRUE" : "FALSE",
			addedOn,
			addedOn ? daysBetweenDays(addedOn, today) : "",
			age.enteredOn,
			age.enteredOn
				? daysBetweenDays(age.enteredOn, today)
				: "",
			age.seeded ? "TRUE" : "FALSE",
			overdue !== "" && overdue > 0 ? overdue : "",
			"FALSE",
		]);
	});

	// Exit rows: present in the prior snapshot, absent now. `prior` already excludes
	// earlier exit rows, so a task exits exactly once.
	Object.keys(prior).forEach((id) => {
		if (seen[id]) return;
		const p = prior[id];
		rows.push([
			today,
			id,
			p.content,
			p.project_name,
			p.area,
			p.area_source,
			p.in_week,
			p.section_name,
			p.work_stage,
			p.labels,
			p.priority,
			p.due_date,
			p.deadline_date,
			p.is_recurring,
			p.is_subtask,
			p.added_on,
			p.added_on ? daysBetweenDays(p.added_on, today) : "",
			p.section_entered_on,
			p.section_entered_on
				? daysBetweenDays(p.section_entered_on, today)
				: "",
			p.section_age_seeded,
			"", // an exited task is not overdue; it is gone
			"TRUE",
		]);
	});

	return rows;
}

// The four cases. Returns { enteredOn, seeded }.
function sectionAgeFor(priorRow, sectionName, stage, addedOn, today) {
	if (priorRow) {
		if (
			String(priorRow.section_name || "") ===
			String(sectionName || "")
		) {
			// Same section as yesterday — carry the date, and carry the seeded
			// flag with it. A floor stays a floor for the life of the task.
			return {
				enteredOn: priorRow.section_entered_on || today,
				seeded:
					String(
						priorRow.section_age_seeded ||
							"",
					).toUpperCase() === "TRUE",
			};
		}
		// An observed move: we watched it happen, so the date is exact.
		return { enteredOn: today, seeded: false };
	}
	// First time we have ever seen this task.
	if (TASK_DAILY_BIRTH_STAGES.indexOf(stage) !== -1 && addedOn) {
		// A task starts life in a birth section, so its section age is its age.
		return { enteredOn: addedOn, seeded: true };
	}
	// It was already somewhere else when we first looked. Today is a FLOOR — the
	// true date is unknowable and could be months earlier.
	return { enteredOn: today, seeded: true };
}

// Normalise incompatible board vocabularies onto one scale.
//
// `Study/Reading` runs Backlog / In Progress / Quiz / Done; `Ascensus` swaps Done and
// Blocked; several projects have no sections at all. Without this, "how much work is in
// review" cannot be asked across projects.
//
// `Quiz` folds into `review` — it is Study/Reading's verification step, the same role
// review plays elsewhere.
//
// Anything unrecognised returns `other`, which is the RENAME TRIPWIRE: a section renamed
// in Todoist shows up as a growing `other` bucket instead of silently vanishing from
// every chart.
function workStageOf(sectionName) {
	const n = String(sectionName || "")
		.trim()
		.toLowerCase();
	if (!n) return ""; // the project has no sections — not a stage, an absence
	if (/^(backlog|to ?do|ideas|inbox|new)$/.test(n)) return "backlog";
	if (/^(in progress|doing|active|wip|in development)$/.test(n))
		return "active";
	if (/^(in review|review|quiz|qa|testing|verification)$/.test(n))
		return "review";
	if (/^(done|complete|completed|shipped|closed)$/.test(n)) return "done";
	if (/^(blocked|waiting|on hold|paused)$/.test(n)) return "blocked";
	if (/^(canceled|cancelled|dropped|abandoned|won'?t do)$/.test(n))
		return "canceled";
	return "other";
}

// The last snapshot day STRICTLY BEFORE `today`, as task_id → row fields.
//
// Two things this must get right, both of which are silent when wrong:
//   * strictly before, so an hourly re-run does not read its own half-written rows and
//     reset every section age to zero;
//   * exit rows excluded, or a task that left last week is resurrected as a fresh exit
//     row every single night.
function readPriorTaskState(sheet, today) {
	const out = {};
	const lastRow = sheet.getLastRow();
	if (lastRow < 2) return out;

	const data = sheet
		.getRange(2, 1, lastRow - 1, TASK_DAILY_HEADER.length)
		.getValues();

	let priorDay = "";
	for (let i = 0; i < data.length; i++) {
		const day = dateKey(data[i][0]).slice(0, 10);
		if (!day || day >= today) continue;
		if (day > priorDay) priorDay = day;
	}
	if (!priorDay) return out;

	for (let i = 0; i < data.length; i++) {
		const r = data[i];
		if (dateKey(r[0]).slice(0, 10) !== priorDay) continue;
		if (String(r[21] || "").toUpperCase() === "TRUE") continue; // an exit
		out[String(r[1])] = {
			content: r[2],
			project_name: r[3],
			area: r[4],
			area_source: r[5],
			in_week: r[6],
			section_name: r[7],
			work_stage: r[8],
			labels: r[9],
			priority: r[10],
			due_date: dateKey(r[11]).slice(0, 10),
			deadline_date: dateKey(r[12]).slice(0, 10),
			is_recurring: r[13],
			is_subtask: r[14],
			added_on: dateKey(r[15]).slice(0, 10),
			section_entered_on: dateKey(r[17]).slice(0, 10),
			section_age_seeded: r[19],
		};
	}
	return out;
}

function replaceTaskDailyRows(sheet, day, rows) {
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
				TASK_DAILY_HEADER.length,
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

function getOrCreateTaskDailySheet(ss) {
	let sheet = ss.getSheetByName("TaskDaily");
	if (!sheet) {
		sheet = ss.insertSheet("TaskDaily");
		sheet.getRange(1, 1, 1, TASK_DAILY_HEADER.length).setValues([
			TASK_DAILY_HEADER,
		]);
		return sheet;
	}
	const existing = sheet.getLastColumn()
		? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
		: [];
	if (existing.join("|") !== TASK_DAILY_HEADER.join("|")) {
		return archiveAndRecreateSheet(
			ss,
			sheet,
			"TaskDaily",
			TASK_DAILY_HEADER,
		);
	}
	return sheet;
}

// MANUAL. Drops snapshot rows older than `keepDays`.
//
// Not wired into the nightly run on purpose: these rows are observations that nothing can
// rebuild, so deleting them is a decision, not a maintenance task. Run it only once you
// have decided the old detail is genuinely disposable — `AreaDaily` keeps the daily counts
// either way, so what is lost is card-level detail, not the trend.
function pruneTaskDaily(keepDays) {
	const days = Number(keepDays) || 400;
	const ss = SpreadsheetApp.openById(TODOIST_SPREADSHEET_ID);
	const sheet = ss.getSheetByName("TaskDaily");
	if (!sheet || sheet.getLastRow() < 2) {
		Logger.log("pruneTaskDaily: nothing to prune");
		return;
	}
	const cutoff = localDateString(new Date(Date.now() - days * 86400000));
	const lastRow = sheet.getLastRow();
	const dates = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

	// Rows are chronological, so everything to drop is a contiguous block at the top.
	let lastOld = 0;
	for (let i = 0; i < dates.length; i++) {
		if (dateKey(dates[i][0]).slice(0, 10) < cutoff) lastOld = i + 1;
		else break;
	}
	if (lastOld === 0) {
		Logger.log(`pruneTaskDaily: nothing older than ${cutoff}`);
		return;
	}
	sheet.deleteRows(2, lastOld);
	Logger.log(
		`pruneTaskDaily: deleted ${lastOld} row(s) older than ${cutoff}. ` +
			"Card-level detail for those days is gone; AreaDaily still has the counts.",
	);
}
