// ─────────────────────────────────────────────────────────────────────────────
// Todoist Sync — quantified-self-sync (standalone Apps Script project)
//
// Uses the Todoist UNIFIED API v1 (api.todoist.com/api/v1). The old REST v2 and
// Sync v9 APIs were deprecated and shut down in early 2026 — calling /rest/v2/*
// now returns a non-JSON deprecation notice ("This endpoint ..."), which is what
// caused the "Unexpected token 'T'" JSON.parse error.
//
// Required Script Properties (Project Settings → Script Properties):
//   TODOIST_TOKEN           Bearer token — todoist.com/app/settings/integrations/developer
//   TODOIST_SPREADSHEET_ID  the <ID> from the quantified-self-todoist URL:
//                           https://docs.google.com/spreadsheets/d/<ID>/edit
//
// Time-based trigger: syncTodoist() daily at 23:30
// AFTER SETUP: run testTodoist() once from the editor — it probes each endpoint
// and logs the response shape, so you can confirm the v1 paths work with your
// account before trusting the nightly run.
// ─────────────────────────────────────────────────────────────────────────────

const TODOIST_BASE = "https://api.todoist.com/api/v1";

// ── Secrets ─────────────────────────────────────────────────────────────────
// Read once from Script Properties so the real values never live in this file.
// Top-level code runs on every execution in this shared project (including
// syncEverhour), so only *read* here — never throw. Validation is in syncTodoist().
const TODOIST_TOKEN =
	PropertiesService.getScriptProperties().getProperty("TODOIST_TOKEN");
const TODOIST_SPREADSHEET_ID =
	PropertiesService.getScriptProperties().getProperty(
		"TODOIST_SPREADSHEET_ID",
	);

// Completed-tasks window cannot exceed ~3 months per request; clamp the cursor.
const MAX_COMPLETED_SPAN_MS = 90 * 86400000;

// Entry point — called by the daily time trigger
function syncTodoist() {
	if (!TODOIST_TOKEN || !TODOIST_SPREADSHEET_ID) {
		throw new Error(
			"Missing secrets. Set TODOIST_TOKEN and TODOIST_SPREADSHEET_ID in " +
				"Project Settings → Script Properties.",
		);
	}
	// Run each step in isolation so one failing endpoint doesn't abort the others;
	// collect failures and surface them at the end so they show in the dashboard.
	const errors = [];
	[
		["Completions", syncCompletions],
		["Overdue", syncOverdue],
		["KarmaStats", syncKarmaStats],
		["RecurringStatus", syncRecurringStatus],
	].forEach(([name, fn]) => {
		try {
			fn();
		} catch (e) {
			errors.push(`${name}: ${e.message || e}`);
			Logger.log(`${name} FAILED: ${e}`);
		}
	});
	if (errors.length)
		throw new Error(
			"Some Todoist steps failed → " + errors.join(" | "),
		);
}

// ── Completions ───────────────────────────────────────────────────────────────

function syncCompletions() {
	const ss = SpreadsheetApp.openById(TODOIST_SPREADSHEET_ID);
	const sheet = ss.getSheetByName("Completions");

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

	// Single source: the /activities log. It returns EVERY completion — recurring
	// check-offs (which /tasks/completed never returns) AND one-off tasks — and reaches
	// further back than the completed-tasks endpoint's 90-day window. We deliberately do
	// NOT also query /tasks/completed: the same completion appears in both with
	// timestamps ~1s apart (completed_at vs event_date), which would defeat the
	// task_id|completed_at dedup key and produce duplicate rows on a full backfill.
	// Trade-off: activity events don't carry task duration, so duration_minutes stays blank.
	// Note: /activities ignores since/until (server-side), so this is always full history;
	// the existing-rows dedup below is what keeps each daily run incremental.
	const allTasks = fetchActivityCompletions(sinceDate, until);
	Logger.log(
		`Completions: ${allTasks.length} activity completion events`,
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
		.map((t) => [
			t.completed_at || until.toISOString(),
			String(t.id),
			t.content || "",
			t.project_id ? String(t.project_id) : "",
			projectMap[String(t.project_id)] || "",
			t.section_id
				? sectionMap[String(t.section_id)] || ""
				: "",
			(t.labels || []).join(","),
			t.priority || 1,
			t.due && t.due.is_recurring ? "TRUE" : "FALSE",
			t.due ? t.due.date : "",
			durationMinutes(t.duration),
			toDateString(new Date()),
			t.parent_id || t.parentId || "", // self-blend key: parent_id ↔ task_id
		]);

	if (rows.length > 0) {
		sheet.getRange(
			sheet.getLastRow() + 1,
			1,
			rows.length,
			rows[0].length,
		).setValues(rows);
	}

	setLastSyncTime(until.toISOString());
	Logger.log(
		`Completions: ${allTasks.length} activity events, appended ${rows.length} new rows`,
	);
}

// ── Overdue ───────────────────────────────────────────────────────────────────

function syncOverdue() {
	const ss = SpreadsheetApp.openById(TODOIST_SPREADSHEET_ID);
	const sheet = ss.getSheetByName("Overdue");

	const today = toDateString(new Date());

	// Delete today's existing snapshot rows (column A = snapshot_date).
	// Use dateKey() because Sheets returns column A as a Date once the column is
	// date-formatted — a raw === against "YYYY-MM-DD" would silently never match
	// and the new snapshot would be appended on top of the old one (duplicates).
	const data = sheet.getDataRange().getValues();
	for (let i = data.length - 1; i >= 1; i--) {
		if (dateKey(data[i][0]) === today) sheet.deleteRow(i + 1);
	}

	// v1: get tasks matching a filter query (replaces the old ?filter= param)
	const tasks = todoistGetPaged("/tasks/filter", { query: "overdue" });
	const projectMap = getProjectMap();

	const todayMs = new Date(today).getTime();
	const rows = tasks.map((t) => {
		const dueDate = t.due ? t.due.date : "";
		const dueDateMs = dueDate
			? new Date(dueDate).getTime()
			: todayMs;
		const daysOverdue = Math.floor(
			(todayMs - dueDateMs) / 86400000,
		);
		return [
			today,
			String(t.id),
			t.content || "",
			projectMap[String(t.project_id)] || "",
			(t.labels || []).join(","),
			dueDate,
			daysOverdue,
			t.priority || 1,
			t.due && t.due.is_recurring ? "TRUE" : "FALSE",
			t.parent_id || t.parentId || "", // self-blend key: parent_id ↔ task_id
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
	Logger.log(`Overdue: wrote ${rows.length} rows for ${today}`);
}

// ── Karma Stats ─────────────────────────────────────────────────────────────

function syncKarmaStats() {
	const ss = SpreadsheetApp.openById(TODOIST_SPREADSHEET_ID);
	const sheet = ss.getSheetByName("KarmaStats");

	const today = toDateString(new Date());

	// Build the existing-dates Set with dateKey() — Sheets returns date-formatted
	// cells as Date objects, so the default String() in getExistingIds yields
	// "Tue May 26 2026 …" and the today-match silently fails.
	const lastRowExisting = sheet.getLastRow();
	const existingDates = new Set();
	if (lastRowExisting >= 2) {
		sheet.getRange(2, 1, lastRowExisting - 1, 1)
			.getValues()
			.forEach((r) => existingDates.add(dateKey(r[0])));
	}

	const stats = fetchTodoistStats();

	// Defensive field reads — v1 nests these slightly differently than Sync v9.
	const karma = num(
		stats.karma != null
			? stats.karma
			: stats.user && stats.user.karma,
	);
	const daysItems =
		stats.days_items ||
		(stats.completed && stats.completed.days_items) ||
		[];
	const todayStats = daysItems.find((d) => d.date === today) || {};
	const streak =
		(stats.goals &&
			stats.goals.current_daily_streak &&
			stats.goals.current_daily_streak.count) ||
		(stats.goals && stats.goals.daily_streak) ||
		"";

	// karma delta from yesterday's row
	let karmaDelta = 0;
	const lastRow = sheet.getLastRow();
	if (lastRow > 1)
		karmaDelta = karma - num(sheet.getRange(lastRow, 2).getValue());

	const row = [
		today,
		karma,
		karmaDelta,
		todayStats.total_completed || 0,
		todayStats.total_added || 0,
		streak,
		today,
	];

	if (existingDates.has(today)) {
		const data = sheet.getDataRange().getValues();
		for (let i = 1; i < data.length; i++) {
			if (dateKey(data[i][0]) === today) {
				sheet.getRange(i + 1, 1, 1, 7).setValues([row]);
				break;
			}
		}
	} else {
		sheet.appendRow(row);
	}
	Logger.log(
		`KarmaStats: recorded karma=${karma} delta=${karmaDelta} for ${today}`,
	);
}

// ── Recurring Status (snapshot approach for recurring task completions) ───────
//
// The Todoist v1 API has no activity log — recurring task check-offs are never
// returned by /tasks/completed. This function works around that by taking a daily
// snapshot of every active recurring task and its current due_date. When a task's
// due_date advances between consecutive daily snapshots, it was completed on the
// earlier date. Looker Studio can reconstruct the completion timeline by comparing
// consecutive rows for the same task_id.
//
// Sheet layout (RecurringStatus):
//   A: snapshot_date  B: task_id  C: content  D: project_name  E: section_name
//   F: labels  G: priority  H: due_date  I: recurrence_string  J: parent_id

function syncRecurringStatus() {
	const ss = SpreadsheetApp.openById(TODOIST_SPREADSHEET_ID);
	let sheet = ss.getSheetByName("RecurringStatus");
	if (!sheet) {
		sheet = ss.insertSheet("RecurringStatus");
		sheet.getRange(1, 1, 1, 10).setValues([
			[
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
			],
		]);
	}

	const today = toDateString(new Date());

	// Replace today's snapshot rows (idempotent re-runs).
	const data = sheet.getDataRange().getValues();
	for (let i = data.length - 1; i >= 1; i--) {
		if (dateKey(data[i][0]) === today) sheet.deleteRow(i + 1);
	}

	const tasks = todoistGetPaged("/tasks/filter", { query: "recurring" });
	const projectMap = getProjectMap();
	const sectionMap = getSectionMap();

	const rows = tasks.map((t) => [
		today,
		String(t.id),
		t.content || "",
		projectMap[String(t.project_id)] || "",
		t.section_id ? sectionMap[String(t.section_id)] || "" : "",
		(t.labels || []).join(","),
		t.priority || 1,
		t.due ? t.due.date : "",
		t.due ? t.due.string || "" : "",
		t.parent_id || "",
	]);

	if (rows.length > 0) {
		sheet.getRange(
			sheet.getLastRow() + 1,
			1,
			rows.length,
			rows[0].length,
		).setValues(rows);
	}
	Logger.log(`RecurringStatus: wrote ${rows.length} rows for ${today}`);
}

// ── Activity completions (recurring check-offs) ───────────────────────────────

// GET /api/v1/activities with event_type=completed returns all task completion events,
// including recurring check-offs that /tasks/completed never sees.
// Endpoint and event_type confirmed from v1 API docs + live testing.
function fetchActivityCompletions(sinceDate, until) {
	try {
		const events = todoistGetPaged("/activities", {
			object_type: "item",
			event_type: "completed",
			since: toTodoistDateTime(sinceDate),
			until: toTodoistDateTime(until),
		});
		Logger.log(`/activities: ${events.length} completion events`);
		return normaliseActivityEvents(events);
	} catch (e) {
		Logger.log(`/activities failed: ${e}`);
		return [];
	}
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
				const isRecurring =
					ex.is_recurring != null
						? ex.is_recurring
						: ex.isRecurring;
				return {
					id: e.object_id || e.objectId,
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
						null,
					section_id:
						ex.section_id ||
						ex.sectionId ||
						null,
					labels: Array.isArray(ex.labels)
						? ex.labels
						: [],
					priority: ex.priority || 1,
					due:
						isRecurring != null
							? {
									is_recurring:
										isRecurring,
									date:
										ex.due_date ||
										ex.dueDate ||
										"",
								}
							: null,
					duration: ex.duration || null,
					parent_id:
						e.parent_id ||
						ex.parent_id ||
						ex.parentId ||
						null,
				};
			})
	);
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

// GET that throws a *legible* error when the response isn't JSON (e.g. an HTML or
// plain-text deprecation notice), instead of a cryptic "Unexpected token" from
// JSON.parse. This is what turns a silent failure into a debuggable message.
function todoistGet(path, params) {
	const qs = buildQuery(params);
	const response = UrlFetchApp.fetch(`${TODOIST_BASE}${path}${qs}`, {
		headers: { Authorization: `Bearer ${TODOIST_TOKEN}` },
		muteHttpExceptions: true,
	});
	const code = response.getResponseCode();
	const body = response.getContentText();
	if (code >= 300) {
		throw new Error(
			`Todoist GET ${path} → HTTP ${code}: ${body.slice(0, 200)}`,
		);
	}
	const trimmed = (body || "").trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
		throw new Error(
			`Todoist GET ${path} returned non-JSON: ${trimmed.slice(0, 200)}`,
		);
	}
	return JSON.parse(trimmed);
}

// Follows v1 cursor pagination: list endpoints return { results: [...], next_cursor }.
// Falls back to { items } or a bare array for endpoints that differ.
// limit=50 is the safe per-page cap; the completed-tasks endpoint silently clamps
// higher values on some accounts, which causes pages to look complete when they aren't.
function todoistGetPaged(path, params) {
	let all = [];
	let cursor = null;
	let guard = 0;
	do {
		const page = todoistGet(path, {
			...(params || {}),
			cursor,
			limit: 50,
		});
		if (Array.isArray(page)) return all.concat(page); // non-paginated endpoint
		const batch = page.results || page.items || [];
		all = all.concat(batch);
		cursor = page.next_cursor || null;
		Logger.log(
			`${path} page ${guard + 1}: got ${batch.length} items (total so far: ${all.length}), has_more=${!!cursor}`,
		);
		// Stop if the page was empty — some endpoints return has_more=true with an
		// empty batch indefinitely until the caller stops (observed on /activities).
		if (batch.length === 0) break;
		if (cursor) Utilities.sleep(300); // courtesy delay between pages
	} while (cursor && ++guard < 50);
	return all;
}

// Productivity stats endpoint moved in v1; try the known candidates and use the
// first that returns JSON (testTodoist() logs which one works for your account).
function fetchTodoistStats() {
	const candidates = ["/tasks/completed/stats", "/user/stats"];
	let lastErr;
	for (const p of candidates) {
		try {
			const s = todoistGet(p);
			Logger.log(`Stats endpoint OK: ${p}`);
			return s;
		} catch (e) {
			lastErr = e;
			Logger.log(`Stats endpoint ${p} failed: ${e}`);
		}
	}
	throw new Error(
		`No working Todoist stats endpoint (${candidates.join(", ")}). Last: ${lastErr}`,
	);
}

// ── Lookups (cached 6h) ─────────────────────────────────────────────────────

function getProjectMap() {
	return cachedIdNameMap("TODOIST_PROJECT_MAP", "/projects");
}

function getSectionMap() {
	return cachedIdNameMap("TODOIST_SECTION_MAP", "/sections");
}

function cachedIdNameMap(cacheKey, path) {
	const cache = CacheService.getScriptCache();
	const cached = cache.get(cacheKey);
	if (cached) return JSON.parse(cached);

	const items = todoistGetPaged(path);
	const map = {};
	items.forEach((i) => {
		map[String(i.id)] = i.name;
	});
	cache.put(cacheKey, JSON.stringify(map), 21600); // 6h
	return map;
}

// ── Small helpers ─────────────────────────────────────────────────────────────

// Build a query string, dropping empty/null params (so cursor=null is omitted).
function buildQuery(params) {
	if (!params) return "";
	const pairs = Object.entries(params)
		.filter(([, v]) => v !== undefined && v !== null && v !== "")
		.map(
			([k, v]) =>
				`${encodeURIComponent(k)}=${encodeURIComponent(v)}`,
		);
	return pairs.length ? "?" + pairs.join("&") : "";
}

// Todoist datetimes are YYYY-MM-DDTHH:MM:SS (no milliseconds / trailing Z).
function toTodoistDateTime(date) {
	return date.toISOString().slice(0, 19);
}

// Convert a Todoist duration object {amount, unit} → whole minutes (or "").
function durationMinutes(duration) {
	if (!duration || !duration.amount) return "";
	return Math.round(
		duration.amount * (duration.unit === "hour" ? 60 : 1),
	);
}

function num(v) {
	const n = Number(v);
	return isNaN(n) ? 0 : n;
}

// Read a column (1-indexed) from a sheet into a Set for O(1) dedup lookups
function getExistingIds(sheet, columnIndex) {
	const lastRow = sheet.getLastRow();
	if (lastRow < 2) return new Set();
	const values = sheet
		.getRange(2, columnIndex, lastRow - 1, 1)
		.getValues();
	return new Set(values.map((r) => String(r[0])));
}

// Composite dedup key for Completions: "task_id|completed_at".
// Recurring tasks reuse the same task_id each time they're checked off — only the
// completion timestamp differs. A task_id-only Set would drop every completion after
// the first, making recurring task history invisible in the sheet.
function getExistingCompletionKeys(sheet) {
	const lastRow = sheet.getLastRow();
	if (lastRow < 2) return new Set();
	const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues(); // cols A (completed_at) & B (task_id)
	return new Set(values.map((r) => `${String(r[1])}|${String(r[0])}`));
}

// Sync cursor stored in Script Properties
function getLastSyncTime() {
	return (
		PropertiesService.getScriptProperties().getProperty(
			"TODOIST_LAST_SYNC",
		) || "2000-01-01T00:00:00Z"
	);
}

function setLastSyncTime(isoTimestamp) {
	PropertiesService.getScriptProperties().setProperty(
		"TODOIST_LAST_SYNC",
		isoTimestamp,
	);
}

// Manual override: clear the sync cursor so the next syncCompletions() pulls the
// full 90-day window. Use this if you want a re-backfill without clearing the
// Completions sheet (the empty-sheet auto-backfill handles the clear-sheet case).
function resetTodoistCursor() {
	PropertiesService.getScriptProperties().deleteProperty(
		"TODOIST_LAST_SYNC",
	);
	Logger.log(
		"TODOIST_LAST_SYNC cleared. Next syncCompletions() will pull the last 90 days.",
	);
}

// Format a Date as YYYY-MM-DD
function toDateString(date) {
	return date.toISOString().split("T")[0];
}

// Normalise a sheet cell value to a YYYY-MM-DD key for comparison.
// Sheets returns a Date object (not a string) once a cell is date-formatted, so
// raw === comparisons against "2026-05-26" silently miss. This helper handles
// both shapes uniformly.
function dateKey(cellValue) {
	if (cellValue instanceof Date) return toDateString(cellValue);
	return String(cellValue || "");
}

// ── Diagnostics ───────────────────────────────────────────────────────────────
// Run this once from the editor after setting the Script Properties. It hits each
// endpoint with limit=1 and logs the response shape, so you can confirm the v1
// paths work for your account (and see exactly what any failing endpoint returns).
function testTodoist() {
	if (!TODOIST_TOKEN)
		throw new Error(
			"Set TODOIST_TOKEN in Script Properties first.",
		);
	const weekAgo = new Date(Date.now() - 7 * 86400000);

	const probe = (label, fn) => {
		try {
			Logger.log(`✓ ${label} → ${describe(fn())}`);
		} catch (e) {
			Logger.log(`✗ ${label} → ${e}`);
		}
	};

	probe("GET /projects", () => todoistGet("/projects", { limit: 1 }));
	probe("GET /sections", () => todoistGet("/sections", { limit: 1 }));
	probe("GET /tasks/filter?query=overdue", () =>
		todoistGet("/tasks/filter", { query: "overdue", limit: 1 }),
	);

	// Completed-tasks diagnostic: shows project distribution, is_recurring count,
	// and checks whether project IDs from completions resolve in the projects map.
	// This tells us if (a) recurring completions ARE returned but project lookup fails,
	// or (b) recurring completions genuinely aren't in this endpoint.
	probe(
		"GET /tasks/completed/by_completion_date — project + recurring breakdown",
		() => {
			const all = todoistGetPaged(
				"/tasks/completed/by_completion_date",
				{
					since: toTodoistDateTime(weekAgo),
					until: toTodoistDateTime(new Date()),
					annotate_items: true,
				},
			);
			const projectMap = getProjectMap();
			const byProject = {};
			let recurringCount = 0;
			all.forEach((t) => {
				const pid = String(t.project_id || "none");
				const name =
					projectMap[pid] || `UNKNOWN(${pid})`;
				byProject[name] = (byProject[name] || 0) + 1;
				if (t.due && t.due.is_recurring)
					recurringCount++;
			});
			Logger.log(
				`Completed tasks by project (last 7d): ${JSON.stringify(byProject)}`,
			);
			Logger.log(
				`Recurring completions in last 7d: ${recurringCount} / ${all.length}`,
			);
			if (all.length > 0) {
				Logger.log(
					"Sample completed task keys: " +
						JSON.stringify(
							Object.keys(all[0]),
						),
				);
				Logger.log(
					"Sample completed task: " +
						JSON.stringify(all[0]),
				);
			}
			return `${all.length} total, ${recurringCount} recurring`;
		},
	);

	// Probe /activities (plural) — the correct v1 activity log path per API docs.
	// Tries with no filter first to confirm the endpoint responds, then with event_type.
	probe("GET /activities (no filter, limit=1)", () =>
		todoistGet("/activities", { limit: 1 }),
	);
	["item:completed", "completed"].forEach((eventType) => {
		probe(
			`GET /activities event_type=${eventType} (last 7 days)`,
			() => {
				const events = todoistGetPaged("/activities", {
					object_type: "item",
					event_type: eventType,
					since: toTodoistDateTime(weekAgo),
					until: toTodoistDateTime(new Date()),
				});
				if (events.length > 0) {
					Logger.log(
						"Event keys: " +
							JSON.stringify(
								Object.keys(
									events[0],
								),
							),
					);
					if (events[0].extra_data)
						Logger.log(
							"extra_data keys: " +
								JSON.stringify(
									Object.keys(
										events[0]
											.extra_data,
									),
								),
						);
					Logger.log(
						"Sample: " +
							JSON.stringify(
								events[0],
							),
					);
				}
				return `${events.length} events`;
			},
		);
	});

	probe("stats", fetchTodoistStats);
}

function describe(r) {
	if (Array.isArray(r)) return `array[${r.length}]`;
	if (r && typeof r === "object")
		return `object keys: {${Object.keys(r).join(", ")}}`;
	return String(r);
}
