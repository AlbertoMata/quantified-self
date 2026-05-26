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
const TODOIST_TOKEN = PropertiesService.getScriptProperties().getProperty("TODOIST_TOKEN");
const TODOIST_SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty("TODOIST_SPREADSHEET_ID");

// Completed-tasks window cannot exceed ~3 months per request; clamp the cursor.
const MAX_COMPLETED_SPAN_MS = 90 * 86400000;

// Entry point — called by the daily time trigger
function syncTodoist() {
  if (!TODOIST_TOKEN || !TODOIST_SPREADSHEET_ID) {
    throw new Error(
      "Missing secrets. Set TODOIST_TOKEN and TODOIST_SPREADSHEET_ID in " +
      "Project Settings → Script Properties."
    );
  }
  // Run each step in isolation so one failing endpoint doesn't abort the others;
  // collect failures and surface them at the end so they show in the dashboard.
  const errors = [];
  [["Completions", syncCompletions], ["Overdue", syncOverdue], ["KarmaStats", syncKarmaStats]]
    .forEach(([name, fn]) => {
      try { fn(); }
      catch (e) { errors.push(`${name}: ${e.message || e}`); Logger.log(`${name} FAILED: ${e}`); }
    });
  if (errors.length) throw new Error("Some Todoist steps failed → " + errors.join(" | "));
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
    (sheetIsEmpty ? " (auto-backfill: sheet was empty)" : "")
  );

  const projectMap = getProjectMap();
  const sectionMap = getSectionMap();
  const existingIds = getExistingIds(sheet, 2); // column B = task_id

  // v1: completed tasks by completion date (since/until required; ≤ 3 months apart)
  const tasks = todoistGetPaged("/tasks/completed/by_completion_date", {
    since: toTodoistDateTime(sinceDate),
    until: toTodoistDateTime(until),
  });

  const rows = tasks
    .filter(t => !existingIds.has(String(t.id)))
    .map(t => [
      t.completed_at || until.toISOString(),
      String(t.id),
      t.content || "",
      t.project_id ? String(t.project_id) : "",
      projectMap[String(t.project_id)] || "",
      t.section_id ? (sectionMap[String(t.section_id)] || "") : "",
      (t.labels || []).join(","),
      t.priority || 1,
      t.due && t.due.is_recurring ? "TRUE" : "FALSE",
      t.due ? t.due.date : "",
      durationMinutes(t.duration),
      toDateString(new Date()),
      t.parent_id || t.parentId || "", // self-blend key: parent_id ↔ task_id
    ]);

  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }

  setLastSyncTime(until.toISOString());
  Logger.log(`Completions: API returned ${tasks.length} tasks, appended ${rows.length} new rows`);
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
  const rows = tasks.map(t => {
    const dueDate = t.due ? t.due.date : "";
    const dueDateMs = dueDate ? new Date(dueDate).getTime() : todayMs;
    const daysOverdue = Math.floor((todayMs - dueDateMs) / 86400000);
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
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
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
    sheet.getRange(2, 1, lastRowExisting - 1, 1).getValues()
      .forEach(r => existingDates.add(dateKey(r[0])));
  }

  const stats = fetchTodoistStats();

  // Defensive field reads — v1 nests these slightly differently than Sync v9.
  const karma = num(stats.karma != null ? stats.karma : (stats.user && stats.user.karma));
  const daysItems = stats.days_items || (stats.completed && stats.completed.days_items) || [];
  const todayStats = daysItems.find(d => d.date === today) || {};
  const streak =
    (stats.goals && stats.goals.current_daily_streak && stats.goals.current_daily_streak.count) ||
    (stats.goals && stats.goals.daily_streak) || "";

  // karma delta from yesterday's row
  let karmaDelta = 0;
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) karmaDelta = karma - num(sheet.getRange(lastRow, 2).getValue());

  const row = [
    today, karma, karmaDelta,
    todayStats.total_completed || 0,
    todayStats.total_added || 0,
    streak,
    today,
  ];

  if (existingDates.has(today)) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (dateKey(data[i][0]) === today) { sheet.getRange(i + 1, 1, 1, 7).setValues([row]); break; }
    }
  } else {
    sheet.appendRow(row);
  }
  Logger.log(`KarmaStats: recorded karma=${karma} delta=${karmaDelta} for ${today}`);
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
    throw new Error(`Todoist GET ${path} → HTTP ${code}: ${body.slice(0, 200)}`);
  }
  const trimmed = (body || "").trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    throw new Error(`Todoist GET ${path} returned non-JSON: ${trimmed.slice(0, 200)}`);
  }
  return JSON.parse(trimmed);
}

// Follows v1 cursor pagination: list endpoints return { results: [...], next_cursor }.
// Falls back to { items } or a bare array for endpoints that differ.
function todoistGetPaged(path, params) {
  let all = [];
  let cursor = null;
  let guard = 0;
  do {
    const page = todoistGet(path, { ...(params || {}), cursor, limit: 200 });
    if (Array.isArray(page)) return all.concat(page); // non-paginated endpoint
    all = all.concat(page.results || page.items || []);
    cursor = page.next_cursor || null;
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
    } catch (e) { lastErr = e; Logger.log(`Stats endpoint ${p} failed: ${e}`); }
  }
  throw new Error(`No working Todoist stats endpoint (${candidates.join(", ")}). Last: ${lastErr}`);
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
  items.forEach(i => { map[String(i.id)] = i.name; });
  cache.put(cacheKey, JSON.stringify(map), 21600); // 6h
  return map;
}

// ── Small helpers ─────────────────────────────────────────────────────────────

// Build a query string, dropping empty/null params (so cursor=null is omitted).
function buildQuery(params) {
  if (!params) return "";
  const pairs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return pairs.length ? "?" + pairs.join("&") : "";
}

// Todoist datetimes are YYYY-MM-DDTHH:MM:SS (no milliseconds / trailing Z).
function toTodoistDateTime(date) {
  return date.toISOString().slice(0, 19);
}

// Convert a Todoist duration object {amount, unit} → whole minutes (or "").
function durationMinutes(duration) {
  if (!duration || !duration.amount) return "";
  return Math.round(duration.amount * (duration.unit === "hour" ? 60 : 1));
}

function num(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

// Read a column (1-indexed) from a sheet into a Set for O(1) dedup lookups
function getExistingIds(sheet, columnIndex) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return new Set();
  const values = sheet.getRange(2, columnIndex, lastRow - 1, 1).getValues();
  return new Set(values.map(r => String(r[0])));
}

// Sync cursor stored in Script Properties
function getLastSyncTime() {
  return PropertiesService.getScriptProperties().getProperty("TODOIST_LAST_SYNC") || "2000-01-01T00:00:00Z";
}

function setLastSyncTime(isoTimestamp) {
  PropertiesService.getScriptProperties().setProperty("TODOIST_LAST_SYNC", isoTimestamp);
}

// Manual override: clear the sync cursor so the next syncCompletions() pulls the
// full 90-day window. Use this if you want a re-backfill without clearing the
// Completions sheet (the empty-sheet auto-backfill handles the clear-sheet case).
function resetTodoistCursor() {
  PropertiesService.getScriptProperties().deleteProperty("TODOIST_LAST_SYNC");
  Logger.log("TODOIST_LAST_SYNC cleared. Next syncCompletions() will pull the last 90 days.");
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
  if (!TODOIST_TOKEN) throw new Error("Set TODOIST_TOKEN in Script Properties first.");
  const weekAgo = new Date(Date.now() - 7 * 86400000);

  const probe = (label, fn) => {
    try { Logger.log(`✓ ${label} → ${describe(fn())}`); }
    catch (e) { Logger.log(`✗ ${label} → ${e}`); }
  };

  probe("GET /projects", () => todoistGet("/projects", { limit: 1 }));
  probe("GET /sections", () => todoistGet("/sections", { limit: 1 }));
  probe("GET /tasks/filter?query=overdue", () => todoistGet("/tasks/filter", { query: "overdue", limit: 1 }));
  probe("GET /tasks/completed/by_completion_date", () => todoistGet("/tasks/completed/by_completion_date", {
    since: toTodoistDateTime(weekAgo), until: toTodoistDateTime(new Date()), limit: 1,
  }));
  probe("stats", fetchTodoistStats);
}

function describe(r) {
  if (Array.isArray(r)) return `array[${r.length}]`;
  if (r && typeof r === "object") return `object keys: {${Object.keys(r).join(", ")}}`;
  return String(r);
}
