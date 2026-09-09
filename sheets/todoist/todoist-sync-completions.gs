// ─────────────────────────────────────────────────────────────────────────────
// Todoist Sync — Completions
// Handles regular and recurring task completions
//
// Two DISJOINT completion sources — no cross-endpoint join needed:
//   1. One-off completions  → /tasks/completed/by_completion_date
//        Returns full task objects (labels, project, section, due, duration, parent).
//        Recurring check-offs NEVER appear here (verified live: the Habits project
//        returns 0 rows even on days it was checked off).
//   2. Recurring check-offs → /activities, event_type=completed, filtered to is_recurring
//        extra_data carries content, labels, parent_id, priority and the recurrence flag
//        (verified live on habit check-offs), so these events are essentially complete on
//        their own. Two exceptions worth knowing:
//          - the PROJECT is at the top level as parent_project_id, not in extra_data;
//          - due_date is already the NEXT occurrence — the completed one is
//            completed_due_date (see normaliseActivityEvents).
//        Labels are omitted entirely for a task that has none, so enrichFromLiveTask()
//        stands by as a fallback for anything an event leaves out. It is a guard, not the
//        primary path: in normal operation it changes nothing.
//
// Because the two sets are disjoint by construction, the same completion can't appear
// twice, so labels/complexity populate for BOTH task types without a fragile task_id
// join against a second endpoint (the previous approach, which left dev/story tasks —
// the ones carrying numeric complexity labels — blank).
// ─────────────────────────────────────────────────────────────────────────────

// Main sync function for regular and recurring task completions
function syncCompletions() {
	const ss = SpreadsheetApp.openById(TODOIST_SPREADSHEET_ID);
	const sheet = ss.getSheetByName("Completions");
	ensureCompletionsAreaColumns(sheet);
	_liveTaskMap = null; // drop last run's snapshot if this is a repeat call in one execution

	// Window: usually [last sync → now], clamped to the API's ~3-month max span.
	// Exception: if the sheet is empty (e.g. you manually cleared rows to re-backfill),
	// ignore the cursor and pull the full 90-day window so the sheet refills itself.
	const sheetIsEmpty = sheet.getLastRow() < 2;
	let sinceDate = sheetIsEmpty
		? new Date(Date.now() - MAX_COMPLETED_SPAN_MS)
		: new Date(getLastSyncTime());
	if (Date.now() - sinceDate.getTime() > MAX_COMPLETED_SPAN_MS) {
		sinceDate = new Date(Date.now() - MAX_COMPLETED_SPAN_MS);
	}
	const until = new Date();
	Logger.log(
		`Completions: window ${toTodoistDateTime(sinceDate)} → ${toTodoistDateTime(until)}` +
			(sheetIsEmpty
				? " (auto-backfill: sheet was empty)"
				: ""),
	);

	const projectMap = getProjectMap();
	const sectionMap = getSectionMap();
	// Fetched once for the whole batch: areaOf() is pure and takes the tree as an
	// argument precisely so a 200-row map does not hit the cache 200 times.
	const projectTree = getProjectTree();
	const existingKeys = getExistingCompletionKeys(sheet);

	// Three sources feed the sheet. The first two are completions proper (disjoint, see
	// file header); the third is an "In Review" STATE snapshot, not an event: we count
	// only tasks that ENTERED since the last run (current − previous), so a task is
	// recorded the day it moves into In Review — and again if it later leaves and
	// re-enters. The previous membership is persisted only AFTER rows are written (below),
	// so a failed write is safely retried next run rather than silently dropped.
	const oneOffCompletions = fetchOneOffCompletions(sinceDate, until);
	const recurringCompletions = fetchRecurringCompletions(
		sinceDate,
		until,
	);
	const inReviewTasks = fetchSectionMovementCompletions(
		TARGET_PROJECTS,
		sinceDate,
		until,
	);
	const prevInReview = getPrevInReviewIds();
	const sectionMovements = inReviewTasks.filter(
		(t) => !prevInReview.has(String(t.id)),
	);
	const allTasks = oneOffCompletions
		.concat(recurringCompletions)
		.concat(sectionMovements);
	Logger.log(
		`Completions: ${oneOffCompletions.length} one-off, ${recurringCompletions.length} recurring, ${sectionMovements.length} new In Review`,
	);

	const rows = allTasks
		// Require a task_id — completions we can't tie to a task are dropped, not stored.
		.filter(
			(t) =>
				t.id &&
				!existingKeys.has(
					`${String(t.id)}|${t.completed_at || ""}`,
				),
		)
		.map((t) =>
			completionRow(
				t,
				projectMap,
				sectionMap,
				projectTree,
				until,
			),
		);

	if (rows.length > 0) {
		sheet.getRange(
			sheet.getLastRow() + 1,
			1,
			rows.length,
			rows[0].length,
		).setValues(rows);
	}

	// Persist current In Review membership for next run's "entered since" diff. Done
	// after the write above so a thrown write doesn't advance the baseline and lose rows.
	setPrevInReviewIds(inReviewTasks.map((t) => String(t.id)));

	setLastSyncTime(until.toISOString());
	Logger.log(
		`Completions: ${oneOffCompletions.length} one-off + ${recurringCompletions.length} recurring + ${sectionMovements.length} In Review (of ${inReviewTasks.length} currently in review), appended ${rows.length} new rows`,
	);
}

// ── Layout guard ──────────────────────────────────────────────────────────────

// `Completions` predates every header-writing convention in this project: it has no
// header constant and no layout guard, and columns A–N are read POSITIONALLY by several
// callers. So this deliberately does the narrowest possible thing — it names the three
// appended columns and touches nothing else.
//
// Widening the row array alone would not corrupt anything (setValues starts at column 1
// and takes its width from the array, so values land in O–Q correctly), but the columns
// would sit under blank headers and no by-name reader would find them.
//
// Refuses to overwrite. If O/P/Q already hold different names, something else owns that
// space and clobbering it is worse than stopping.
const COMPLETIONS_AREA_COL_START = 15; // column O
const COMPLETIONS_AREA_COLUMNS = ["area", "area_source", "was_overdue"];

function ensureCompletionsAreaColumns(sheet) {
	const width = COMPLETIONS_AREA_COLUMNS.length;
	const needed = COMPLETIONS_AREA_COL_START + width - 1;
	// A new sheet defaults to 26 columns, but a trimmed one can be exactly 14 wide —
	// and getRange() past the last column throws rather than growing the sheet.
	if (sheet.getMaxColumns() < needed) {
		sheet.insertColumnsAfter(
			sheet.getMaxColumns(),
			needed - sheet.getMaxColumns(),
		);
	}
	const existing = sheet
		.getRange(1, COMPLETIONS_AREA_COL_START, 1, width)
		.getValues()[0]
		.map((v) => String(v || "").trim());

	if (existing.join("|") === COMPLETIONS_AREA_COLUMNS.join("|")) return;

	const occupied = existing.filter((v) => v !== "");
	if (occupied.length > 0) {
		throw new Error(
			`Completions columns O–Q are [${existing.join(", ")}], expected ` +
				`[${COMPLETIONS_AREA_COLUMNS.join(", ")}]. Refusing to overwrite — ` +
				`fix the header by hand, then re-run.`,
		);
	}

	sheet.getRange(1, COMPLETIONS_AREA_COL_START, 1, width).setValues([
		COMPLETIONS_AREA_COLUMNS,
	]);
	Logger.log(
		`Completions: named columns O–Q ${COMPLETIONS_AREA_COLUMNS.join(", ")}`,
	);
}

// ── Backfill: area on existing rows ───────────────────────────────────────────

// One-time (but safely repeatable). Fills `area` / `area_source` on rows written before
// those columns existed.
//
// This is the payoff of having stored `project_id` on every row since the tab was
// created: area is **fully retroactive** without re-fetching anything. Labels are not —
// column G is frozen at capture, so a row from last March cannot learn about a label
// added today, and it resolves through the project tree instead. That asymmetry is
// expected, and `area_source` is what makes it visible rather than silent.
//
// Only fills BLANKS. It never rewrites a row that already has an area, so re-running is
// a no-op and a later project re-parenting cannot quietly rewrite history behind you.
// Rewriting existing rows is step 3.6's job, and only for the due-date repair.
//
// Not strictly zero-API as first planned: resolving a parent needs the project tree, so
// there is one cached /projects call. Still no completion re-fetch.
function backfillCompletionAreas() {
	const ss = SpreadsheetApp.openById(TODOIST_SPREADSHEET_ID);
	const sheet = ss.getSheetByName("Completions");
	if (!sheet) throw new Error("Completions tab not found");
	ensureCompletionsAreaColumns(sheet);

	const lastRow = sheet.getLastRow();
	if (lastRow < 2) {
		Logger.log("backfillCompletionAreas: no data rows");
		return;
	}
	const n = lastRow - 1;
	const tree = getProjectTree();

	// Columns A–N carry project_id (D, index 3) and labels (G, index 6).
	const source = sheet.getRange(2, 1, n, 14).getValues();
	const target = sheet.getRange(2, COMPLETIONS_AREA_COL_START, n, 2);
	const current = target.getValues();

	const perArea = {};
	const perSource = {};
	let filled = 0;
	let alreadySet = 0;

	const out = current.map((row, i) => {
		if (String(row[0] || "").trim() !== "") {
			alreadySet++;
			return row;
		}
		const resolved = areaOf(
			String(source[i][3] || ""),
			splitLabels(source[i][6]),
			tree,
		);
		perArea[resolved.area] = (perArea[resolved.area] || 0) + 1;
		perSource[resolved.source] =
			(perSource[resolved.source] || 0) + 1;
		filled++;
		return [resolved.area, resolved.source];
	});

	target.setValues(out);
	Logger.log(
		`backfillCompletionAreas: filled ${filled}, left ${alreadySet} already-set rows alone`,
	);
	Logger.log(`  per area:   ${JSON.stringify(perArea)}`);
	Logger.log(`  per source: ${JSON.stringify(perSource)}`);
	if (perArea[AREA_UNCATEGORIZED]) {
		Logger.log(
			`  ${perArea[AREA_UNCATEGORIZED]} row(s) are ${AREA_UNCATEGORIZED} — ` +
				`usually a project that was deleted, so no parent can be resolved. ` +
				`Run diagnoseAreas() to see which.`,
		);
	}
}

// ── The row shape ─────────────────────────────────────────────────────────────

// The single definition of a Completions row, shared by the nightly sync and the
// backfill. Extracted deliberately: two copies of a 17-column layout is precisely how
// a column silently drifts out of alignment with schema/completions.md.
//
// Column order is A–Q and is READ POSITIONALLY by other tabs — append only, never
// reorder or insert.
function completionRow(t, projectMap, sectionMap, projectTree, until) {
	// Every source now carries labels directly (one-off from the completed-tasks
	// object, recurring from extra_data, In Review from the filter query), so
	// complexity — a numeric-only label — derives reliably for all task types.
	const labels = Array.isArray(t.labels) ? t.labels : [];
	// Label first, then the project tree. Captured at write time so the row records
	// what was true then — labels are frozen here, which is exactly why historical
	// rows must be re-derived from project_id instead (backfillCompletionAreas).
	const resolved = areaOf(t.project_id, labels, projectTree);
	return [
		t.completed_at || until.toISOString(),
		String(t.id),
		t.content || "",
		t.project_id ? String(t.project_id) : "",
		projectMap[String(t.project_id)] || "",
		t.section_id ? sectionMap[String(t.section_id)] || "" : "",
		labels.join(","),
		t.priority || 1,
		t.due && t.due.is_recurring ? "TRUE" : "FALSE",
		t.due ? t.due.date : "",
		durationMinutes(t.duration),
		localDateString(new Date()), // local: at 23:30 the UTC date is already tomorrow
		t.parent_id || t.parentId || "", // self-blend key: parent_id ↔ task_id
		extractComplexity(labels) || "", // complexity/story points
		resolved.area, // O
		resolved.source, // P — label | project | parent | default
		// Q — Todoist's own verdict on whether the cycle closed late. Blank, not FALSE,
		// when the source cannot say: only recurring activity events carry it, and
		// "unknown" must not read as "on time".
		t.was_overdue == null ? "" : t.was_overdue ? "TRUE" : "FALSE",
	];
}

// ── Backfill: extend history ──────────────────────────────────────────────────

// Walks backwards to `since` in <=90-day windows and appends anything the sheet is
// missing. The nightly path caps its window at MAX_COMPLETED_SPAN_MS because the API
// hard-errors above a 3-month span ("must not exceed 3 months") — that cap is correct
// PER REQUEST, but it also silently became a limit on total reachable history. Looping
// windows is the whole fix.
//
// Todoist Pro retains history to roughly 2026-02, which is also when this account
// starts, so that is the default floor.
//
// Safe to re-run: the same task_id|completed_at dedup the nightly path uses drops
// everything already present. It deliberately does NOT touch TODOIST_LAST_SYNC — the
// nightly cursor must keep meaning "the last time we caught up to now" — and it skips
// the In Review source entirely, because that one is a STATE snapshot, not history, and
// replaying it would invent movement events that never happened.
const COMPLETIONS_BACKFILL_FLOOR = "2026-02-01";

function backfillCompletions(since) {
	const ss = SpreadsheetApp.openById(TODOIST_SPREADSHEET_ID);
	const sheet = ss.getSheetByName("Completions");
	if (!sheet) throw new Error("Completions tab not found");
	ensureCompletionsAreaColumns(sheet);
	_liveTaskMap = null;

	const floor = new Date(
		`${since || COMPLETIONS_BACKFILL_FLOOR}T00:00:00Z`,
	);
	if (isNaN(floor.getTime())) {
		throw new Error(`backfillCompletions: bad date "${since}"`);
	}

	const projectMap = getProjectMap();
	const sectionMap = getSectionMap();
	const projectTree = getProjectTree();
	const existingKeys = getExistingCompletionKeys(sheet);

	let windowEnd = new Date();
	let totalAppended = 0;
	let totalSeen = 0;
	let guard = 0;

	while (windowEnd.getTime() > floor.getTime() && guard++ < 40) {
		let windowStart = new Date(
			windowEnd.getTime() - MAX_COMPLETED_SPAN_MS,
		);
		if (windowStart.getTime() < floor.getTime()) {
			windowStart = floor;
		}
		Logger.log(
			`backfillCompletions: window ${toTodoistDateTime(windowStart)} → ${toTodoistDateTime(windowEnd)}`,
		);

		const batch = fetchOneOffCompletions(
			windowStart,
			windowEnd,
		).concat(fetchRecurringCompletions(windowStart, windowEnd));
		totalSeen += batch.length;

		const rows = batch
			.filter((t) => {
				if (!t.id) return false;
				const key = `${String(t.id)}|${t.completed_at || ""}`;
				if (existingKeys.has(key)) return false;
				// Guard against duplicates WITHIN this run too: adjacent
				// windows share a boundary instant, and the set is only
				// re-read from the sheet once, before the loop.
				existingKeys.add(key);
				return true;
			})
			.map((t) =>
				completionRow(
					t,
					projectMap,
					sectionMap,
					projectTree,
					windowEnd,
				),
			);

		if (rows.length > 0) {
			sheet.getRange(
				sheet.getLastRow() + 1,
				1,
				rows.length,
				rows[0].length,
			).setValues(rows);
			totalAppended += rows.length;
		}
		Logger.log(
			`  ${batch.length} fetched, ${rows.length} new (running total ${totalAppended})`,
		);

		// Step back a second past the start so windows do not overlap on the
		// boundary instant.
		windowEnd = new Date(windowStart.getTime() - 1000);
		Utilities.sleep(400); // courtesy delay between windows
	}

	Logger.log(
		`backfillCompletions: done — ${totalSeen} events seen, ${totalAppended} rows appended. ` +
			`Cursor untouched; re-running adds zero rows.`,
	);
}

// ── Repair: pre-fix cycle attribution ─────────────────────────────────────────

// The ONLY function here that rewrites existing cells.
//
// Until 2026-08-10 the sync read the activity event's `due_date`, which has ALREADY
// advanced to the next occurrence by the time the event is written. Every recurring row
// written before that day therefore names the wrong occurrence in col J — a day out for a
// daily habit, a whole weekend for a workday one, and **one entire cycle** for a monthly
// bill. That last one is why this matters here: `BillCycle` keys a cycle on col J, so
// without this repair every bill cycle before 2026-08-10 is attributed to the following
// month.
//
// A plain backfill cannot fix these. Dedup is `task_id|completed_at`, so a re-fetch of an
// already-present completion is DROPPED, not rewritten. The cell has to be corrected in
// place, which is what this does.
//
// Scope is deliberately narrow: recurring rows only (one-off rows never had the bug), and
// only those whose `sync_date` predates the fix. Rows it cannot match are LEFT ALONE and
// counted — a wrong date is bad, but blanking a date we simply could not re-verify is
// worse.
//
// Back up the spreadsheet before running this. It is idempotent — a second run finds
// every value already correct and writes nothing — but it edits history in place.
const COMPLETED_DUE_DATE_FIX_DAY = "2026-08-10";

function repairCompletionDueDates() {
	const ss = SpreadsheetApp.openById(TODOIST_SPREADSHEET_ID);
	const sheet = ss.getSheetByName("Completions");
	if (!sheet) throw new Error("Completions tab not found");
	_liveTaskMap = null;

	const lastRow = sheet.getLastRow();
	if (lastRow < 2) {
		Logger.log("repairCompletionDueDates: no data rows");
		return;
	}
	const n = lastRow - 1;
	const data = sheet.getRange(2, 1, n, 14).getValues();

	// Which rows are in scope, and what completion window do they span?
	const targets = [];
	let earliest = null;
	let latest = null;
	for (let i = 0; i < n; i++) {
		const isRecurring =
			String(data[i][8] || "").toUpperCase() === "TRUE";
		if (!isRecurring) continue;
		// sync_date (col L) is when the ROW was written, which is what decides
		// whether the buggy read produced it. completed_at is the fallback for
		// rows old enough to predate the sync_date column being reliable.
		const wrote =
			dateKey(data[i][11]).slice(0, 10) ||
			dateKey(data[i][0]).slice(0, 10);
		if (!wrote || wrote >= COMPLETED_DUE_DATE_FIX_DAY) continue;

		const day = dateKey(data[i][0]).slice(0, 10);
		if (!day) continue;
		targets.push({ row: i, id: String(data[i][1]), day: day });
		if (!earliest || day < earliest) earliest = day;
		if (!latest || day > latest) latest = day;
	}

	if (targets.length === 0) {
		Logger.log(
			`repairCompletionDueDates: no recurring rows written before ${COMPLETED_DUE_DATE_FIX_DAY} — nothing to repair`,
		);
		return;
	}
	Logger.log(
		`repairCompletionDueDates: ${targets.length} candidate rows spanning ${earliest} → ${latest}`,
	);

	// Re-read the activity log across that span. normaliseActivityEvents() already
	// resolves `completed_due_date`, so what comes back is the corrected value.
	const byTaskDay = {};
	let windowEnd = new Date(`${latest}T23:59:59Z`);
	const floor = new Date(`${earliest}T00:00:00Z`);
	let guard = 0;
	while (windowEnd.getTime() >= floor.getTime() && guard++ < 40) {
		let windowStart = new Date(
			windowEnd.getTime() - MAX_COMPLETED_SPAN_MS,
		);
		if (windowStart.getTime() < floor.getTime()) {
			windowStart = floor;
		}
		const events = fetchRecurringCompletions(
			windowStart,
			windowEnd,
		);
		events.forEach((e) => {
			const day = String(e.completed_at || "").slice(0, 10);
			const due = (e.due && e.due.date) || "";
			if (!e.id || !day || !due) return;
			const key = `${String(e.id)}|${day}`;
			(byTaskDay[key] = byTaskDay[key] || []).push({
				at: String(e.completed_at || "").slice(0, 19),
				due: due,
			});
		});
		Logger.log(
			`  window ${toTodoistDateTime(windowStart)} → ${toTodoistDateTime(windowEnd)}: ${events.length} events`,
		);
		windowEnd = new Date(windowStart.getTime() - 1000);
		Utilities.sleep(400);
	}

	// Apply. Read col J as a block, patch in memory, write it back once.
	const dueRange = sheet.getRange(2, 10, n, 1);
	const dueValues = dueRange.getValues();
	let fixed = 0;
	let alreadyRight = 0;
	let unmatched = 0;
	let ambiguous = 0;

	targets.forEach((t) => {
		const candidates = byTaskDay[`${t.id}|${t.day}`];
		if (!candidates || candidates.length === 0) {
			unmatched++;
			return;
		}
		let chosen = candidates[0];
		if (candidates.length > 1) {
			// Two check-offs of the same task on the same day: only an exact
			// timestamp match is safe. The sheet cell may be a Date or a
			// string, so normalise both to 19 chars.
			const cell = data[t.row][0];
			const iso =
				cell instanceof Date
					? cell.toISOString().slice(0, 19)
					: String(cell || "").slice(0, 19);
			const exact = candidates.filter((c) => c.at === iso);
			if (exact.length !== 1) {
				ambiguous++;
				return;
			}
			chosen = exact[0];
		}
		const current = dateKey(dueValues[t.row][0]).slice(0, 10);
		if (current === chosen.due) {
			alreadyRight++;
			return;
		}
		dueValues[t.row][0] = chosen.due;
		fixed++;
	});

	if (fixed > 0) dueRange.setValues(dueValues);

	Logger.log(
		`repairCompletionDueDates: ${fixed} corrected, ${alreadyRight} already right, ` +
			`${unmatched} not found in the activity log, ${ambiguous} ambiguous (left alone)`,
	);
	if (unmatched > 0) {
		Logger.log(
			`  ${unmatched} row(s) predate Todoist's retention window (~2026-02) or their ` +
				`task was deleted. Their col J keeps the old next-occurrence value — ` +
				`record this in history.md rather than assuming the repair was total.`,
		);
	}
}

// ── One-off Completions ───────────────────────────────────────────────────────

// GET /api/v1/tasks/completed/by_completion_date returns full completed-task objects
// (labels, project, section, due, duration, parent) for non-recurring tasks. Recurring
// check-offs are NOT included here — those come from the activity log (see below).
// No annotate_items param: the v1 endpoint inlines all task fields by default; passing
// the legacy Sync-v9 flag is what previously left labels (and thus complexity) blank.
function fetchOneOffCompletions(sinceDate, until) {
	try {
		const tasks = todoistGetPaged(
			"/tasks/completed/by_completion_date",
			{
				since: toTodoistDateTime(sinceDate),
				until: toTodoistDateTime(until),
			},
		);
		Logger.log(
			`/tasks/completed: ${tasks.length} one-off completions`,
		);
		return tasks.map(normaliseCompletedTask);
	} catch (e) {
		Logger.log(`/tasks/completed failed: ${e}`);
		return [];
	}
}

// Normalise a completed-task object to the shape expected by the syncCompletions row
// mapper. v1 uses snake_case (project_id, section_id, …); camelCase fallbacks are kept
// as insurance in case the API representation shifts.
function normaliseCompletedTask(t) {
	const due = t.due || null;
	const isRecurring = due
		? due.is_recurring != null
			? due.is_recurring
			: due.isRecurring
		: false;
	return {
		id: t.id,
		completed_at:
			t.completed_at ||
			t.completedAt ||
			(t.completed_info && t.completed_info.completed_at) ||
			"",
		content: t.content || "",
		project_id: t.project_id || t.projectId || null,
		section_id: t.section_id || t.sectionId || null,
		labels: Array.isArray(t.labels) ? t.labels : [],
		priority: t.priority || 1,
		due: due
			? {
					is_recurring: !!isRecurring,
					date: due.date || "",
				}
			: null,
		duration: t.duration || null,
		parent_id: t.parent_id || t.parentId || null,
		// The completed-tasks endpoint does not report lateness. Left null so the
		// cell stays blank; a one-off bill's lateness is derived at BillCycle time by
		// comparing its due date against when it closed.
		was_overdue: null,
	};
}

// ── Recurring Completions ─────────────────────────────────────────────────────

// GET /api/v1/activities with event_type=completed returns ALL completion events, but we
// keep ONLY recurring check-offs here — one-off completions are sourced from
// /tasks/completed above (with full labels). Recurring activity events DO carry labels in
// extra_data, so they need no enrichment. Endpoint/event_type confirmed from v1 docs.
function fetchRecurringCompletions(sinceDate, until) {
	try {
		const events = todoistGetPaged("/activities", {
			object_type: "item",
			event_type: "completed",
			since: toTodoistDateTime(sinceDate),
			until: toTodoistDateTime(until),
		});
		const recurring = events.filter((e) => {
			const ex = e.extra_data || e.extraData || {};
			const r =
				ex.is_recurring != null
					? ex.is_recurring
					: ex.isRecurring;
			return r === true;
		});
		Logger.log(
			`/activities: ${recurring.length} recurring completions (of ${events.length} total events)`,
		);
		return normaliseActivityEvents(recurring);
	} catch (e) {
		Logger.log(`/activities failed: ${e}`);
		return [];
	}
}

// Open tasks indexed by id, built once per run and reused across every activity event.
// Not cached across runs (CacheService caps a value at 100KB, which a full task list can
// exceed) and not fetched at all unless an activity event actually needs enriching.
let _liveTaskMap = null;

// Backfill the fields the activity log leaves out, from the task as it exists right now.
// This is sound specifically BECAUSE these are recurring: checking one off rolls it to its
// next occurrence rather than removing it, so the task is still there to be read. It would
// NOT be sound for one-off completions — those are gone from /tasks — but those come from
// /tasks/completed with full objects already.
//
// Returns {} when the task can't be found (deleted or made non-recurring since the event,
// or the fetch failed), so every caller degrades to the event's own fields.
function enrichFromLiveTask(taskId) {
	if (_liveTaskMap === null) {
		_liveTaskMap = {};
		try {
			todoistGetPaged("/tasks").forEach((t) => {
				_liveTaskMap[String(t.id)] = {
					labels: Array.isArray(t.labels)
						? t.labels
						: [],
					parent_id:
						t.parent_id ||
						t.parentId ||
						null,
					section_id:
						t.section_id ||
						t.sectionId ||
						null,
					project_id:
						t.project_id ||
						t.projectId ||
						null,
					priority: t.priority || 1,
				};
			});
			Logger.log(
				`Live task map: ${Object.keys(_liveTaskMap).length} open tasks for activity enrichment`,
			);
		} catch (err) {
			// Enrichment is best-effort: a failed fetch must not sink the whole sync.
			Logger.log(
				`Live task map failed — recurring rows keep only the fields the activity log provided: ${err}`,
			);
		}
	}
	return _liveTaskMap[String(taskId)] || {};
}

// Normalise activity log events to the shape expected by the syncCompletions row mapper.
// The raw /activities response uses snake_case (object_id, extra_data, …); camelCase
// fallbacks are kept as insurance in case the API representation shifts.
function normaliseActivityEvents(events) {
	return (
		events
			// Keep only task-completion events that still carry an identifiable id.
			// Records without an object_id can't be tied to a task → skip (no junk rows).
			.filter((e) => {
				const type = e.object_type || e.objectType;
				return (
					type === "item" &&
					(e.object_id || e.objectId)
				);
			})
			.map((e) => {
				const ex = e.extra_data || e.extraData || {};
				const id = e.object_id || e.objectId;
				const isRecurring =
					ex.is_recurring != null
						? ex.is_recurring
						: ex.isRecurring;
				// What the event itself provides. Both of these are routinely absent from
				// extra_data, which is why enrichFromLiveTask() exists — an empty labels
				// cell is not cosmetic here, it silently zeroes the habit count.
				const eventLabels = Array.isArray(ex.labels)
					? ex.labels
					: [];
				// The parent task is `parent_item_id` at the TOP level — the same shape as
				// parent_project_id below, NOT `parent_id` inside extra_data.
				const eventParentId =
					e.parent_item_id ||
					e.parentItemId ||
					ex.parent_id ||
					ex.parentId ||
					null;
				const live = enrichFromLiveTask(id);
				return {
					id: id,
					completed_at:
						e.event_date ||
						e.eventDate ||
						"",
					content: ex.content || "",
					// Activity events carry the project at the TOP level (parent_project_id),
					// NOT inside extra_data — without this the project columns come out blank.
					project_id:
						e.parent_project_id ||
						e.parentProjectId ||
						ex.project_id ||
						live.project_id ||
						null,
					section_id:
						ex.section_id ||
						ex.sectionId ||
						live.section_id ||
						null,
					labels: eventLabels.length
						? eventLabels
						: live.labels || [],
					priority:
						ex.priority ||
						live.priority ||
						1,
					due:
						isRecurring != null
							? {
									is_recurring:
										isRecurring,
									// The occurrence that was COMPLETED — not the one it rolled
									// on to. By the time the event is written, extra_data.due_date
									// is ALREADY the next occurrence (verified live: a habit checked
									// off on Aug 10 carries due_date=Aug 11, completed_due_date=Aug 10).
									// Using due_date dates every recurring completion one occurrence
									// into the future, which silently breaks the streak reconstruction
									// that column J exists for.
									date:
										ex.completed_due_date ||
										ex.completedDueDate ||
										ex.due_date ||
										ex.dueDate ||
										"",
								}
							: null,
					duration: ex.duration || null,
					parent_id:
						eventParentId ||
						live.parent_id ||
						null,
					// Already in the payload and previously thrown away. Given batch
					// check-offs (three bills closed three seconds apart on 2026-09-08),
					// this is the ONLY honest on-time signal — completed_at is not one.
					was_overdue:
						ex.was_overdue != null
							? ex.was_overdue
							: ex.wasOverdue != null
								? ex.wasOverdue
								: null,
				};
			})
	);
}
