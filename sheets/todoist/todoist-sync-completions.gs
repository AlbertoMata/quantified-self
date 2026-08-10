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
	const existingKeys = getExistingCompletionKeys(sheet);

	// Three sources feed the sheet. The first two are completions proper (disjoint, see
	// file header); the third is an "In Review" STATE snapshot, not an event: we count
	// only tasks that ENTERED since the last run (current − previous), so a task is
	// recorded the day it moves into In Review — and again if it later leaves and
	// re-enters. The previous membership is persisted only AFTER rows are written (below),
	// so a failed write is safely retried next run rather than silently dropped.
	const oneOffCompletions = fetchOneOffCompletions(sinceDate, until);
	const recurringCompletions = fetchRecurringCompletions(sinceDate, until);
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
		.map((t) => {
			// Every source now carries labels directly (one-off from the completed-tasks
			// object, recurring from extra_data, In Review from the filter query), so
			// complexity — a numeric-only label — derives reliably for all task types.
			const labels = Array.isArray(t.labels) ? t.labels : [];
			return [
				t.completed_at || until.toISOString(),
				String(t.id),
				t.content || "",
				t.project_id ? String(t.project_id) : "",
				projectMap[String(t.project_id)] || "",
				t.section_id
					? sectionMap[String(t.section_id)] || ""
					: "",
				labels.join(","),
				t.priority || 1,
				t.due && t.due.is_recurring ? "TRUE" : "FALSE",
				t.due ? t.due.date : "",
				durationMinutes(t.duration),
				toDateString(new Date()),
				t.parent_id || t.parentId || "", // self-blend key: parent_id ↔ task_id
				extractComplexity(labels) || "", // complexity/story points
			];
		});

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
		Logger.log(`/tasks/completed: ${tasks.length} one-off completions`);
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
						t.parent_id || t.parentId || null,
					section_id:
						t.section_id || t.sectionId || null,
					project_id:
						t.project_id || t.projectId || null,
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
					priority: ex.priority || live.priority || 1,
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
					parent_id: eventParentId || live.parent_id || null,
				};
			})
	);
}
