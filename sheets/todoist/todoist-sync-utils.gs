// ─────────────────────────────────────────────────────────────────────────────
// Todoist Sync Utilities — Shared helpers for caching, HTTP, and formatting
// ─────────────────────────────────────────────────────────────────────────────

// ── HTTP Helpers ───────────────────────────────────────────────────────────────

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

// POST to the v1 Sync endpoint with item_update (and similar) commands. Writes aren't
// used by the read-only sync jobs, but this lives here so all HTTP stays in one file.
// Returns the parsed response; logs (but does not throw on) per-command failures so a
// partial batch is visible rather than silent.
function todoistSync(commands) {
	if (!commands || commands.length === 0) return { ok: true, empty: true };
	const response = UrlFetchApp.fetch(`${TODOIST_BASE}/sync`, {
		method: "post",
		contentType: "application/json",
		headers: { Authorization: `Bearer ${TODOIST_TOKEN}` },
		payload: JSON.stringify({ commands }),
		muteHttpExceptions: true,
	});
	const code = response.getResponseCode();
	const body = response.getContentText();
	if (code >= 300) {
		throw new Error(`Todoist sync → HTTP ${code}: ${body.slice(0, 300)}`);
	}
	const parsed = JSON.parse(body);
	// sync_status maps each command uuid → "ok" or an error object; surface failures.
	const failures = Object.entries(parsed.sync_status || {}).filter(
		([, v]) => v !== "ok",
	);
	if (failures.length) {
		Logger.log(
			`todoistSync: ${failures.length} command(s) failed: ${JSON.stringify(failures)}`,
		);
	}
	return parsed;
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

// ── Lookups (cached 6h) ────────────────────────────────────────────────────

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

// ── Small Helpers ──────────────────────────────────────────────────────────────

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

// Extract complexity/story points: find the first label that is ONLY digits.
// Example: labels ["high-priority", "5", "backend"] → 5
function extractComplexity(labels) {
	if (!Array.isArray(labels)) return null;
	const numericLabel = labels.find((label) => /^\d+$/.test(label));
	return numericLabel ? parseInt(numericLabel, 10) : null;
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

// Previous "In Review" membership (task_ids), stored in Script Properties. Comparing
// the current snapshot against this set tells us which tasks ENTERED In Review since the
// last run — only those count as completions, so a task is recorded on the day it moves
// in, and again if it later leaves and re-enters. On the very first run the set is empty,
// so every task currently in In Review is treated as new (a one-time backfill).
function getPrevInReviewIds() {
	const raw = PropertiesService.getScriptProperties().getProperty(
		"TODOIST_IN_REVIEW_PREV",
	);
	if (!raw) return new Set();
	try {
		return new Set(JSON.parse(raw).map(String));
	} catch (e) {
		Logger.log(
			`TODOIST_IN_REVIEW_PREV parse failed, treating as empty: ${e}`,
		);
		return new Set();
	}
}

function setPrevInReviewIds(taskIds) {
	PropertiesService.getScriptProperties().setProperty(
		"TODOIST_IN_REVIEW_PREV",
		JSON.stringify(taskIds.map(String)),
	);
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
