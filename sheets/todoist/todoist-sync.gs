// ─────────────────────────────────────────────────────────────────────────────
// Todoist Sync — Main Orchestrator
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

// ── Configuration ──────────────────────────────────────────────────────────
const TARGET_PROJECTS = ["Fullsteam", "Ascensus", "Work"];
const IN_REVIEW_SECTION_NAME = "In Review";
const CACHE_DURATION_HOURS = 6;
const MAX_COMPLETED_SPAN_MS = 90 * 86400000;

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
// Daily snapshot of every active recurring task and its current due_date. When a task's
// due_date advances between consecutive daily snapshots, it was completed on the earlier
// date. Looker Studio can reconstruct the completion timeline by comparing consecutive
// rows for the same task_id.
//
// NOTE: this predates the activity-log source in todoist-sync-completions.gs, which was
// written around the belief that v1 had no activity log. It does — /activities returns
// recurring check-offs directly, and Completions now records them as events. This tab is
// therefore a redundant SECOND view of the same behaviour, kept because a snapshot degrades
// differently from an event stream: it still shows state if /activities is unavailable, but
// it cannot see two completions of the same task between runs. Prefer Completions for
// counting; use this to reconstruct state on days the event source came back empty.
//
// Sub-habits (checklist steps under a habit) are undated and non-recurring by design —
// Todoist unchecks them when their parent recurs — so they never reach this tab. A step
// appearing here means it was given a recurrence it should not have.
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

	probe(
		"GET /activities event_type=updated (section movements, last 7 days)",
		() => {
			const events = todoistGetPaged("/activities", {
				object_type: "item",
				event_type: "updated",
				since: toTodoistDateTime(weekAgo),
				until: toTodoistDateTime(new Date()),
			});
			if (events.length > 0) {
				Logger.log(
					"Updated event keys: " +
						JSON.stringify(
							Object.keys(events[0]),
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
					"extra_data.section_id: " +
						events[0].extra_data
							?.section_id,
				);
				Logger.log(
					"Sample: " + JSON.stringify(events[0]),
				);
			}
			return `${events.length} updated events`;
		},
	);

	// Test complexity extraction on sample tasks
	probe("Complexity extraction test (tasks with numeric labels)", () => {
		const allTasks = todoistGetPaged("/tasks/filter", {
			query: "all & label",
			limit: 10,
		});
		const tasksWithComplexity = allTasks
			.filter((t) => t.labels && t.labels.length > 0)
			.map((t) => ({
				id: t.id,
				content: t.content,
				labels: t.labels,
				extracted_complexity: extractComplexity(
					t.labels,
				),
			}));
		if (tasksWithComplexity.length > 0) {
			Logger.log(
				"Sample tasks with complexity: " +
					JSON.stringify(
						tasksWithComplexity.slice(0, 3),
					),
			);
		}
		const withComplexity = tasksWithComplexity.filter(
			(t) => t.extracted_complexity != null,
		);
		return `${tasksWithComplexity.length} tasks checked, ${withComplexity.length} with numeric complexity`;
	});

	probe("stats", fetchTodoistStats);
}

function describe(r) {
	if (Array.isArray(r)) return `array[${r.length}]`;
	if (r && typeof r === "object")
		return `object keys: {${Object.keys(r).join(", ")}}`;
	return String(r);
}
