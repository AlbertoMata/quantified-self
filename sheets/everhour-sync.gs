// ─────────────────────────────────────────────────────────────────────────────
// Everhour Sync — quantified-self-sync (standalone Apps Script project)
//
// Required Script Properties (Project Settings → Script Properties):
//   EVERHOUR_API_KEY        API key — Everhour → My Profile → Settings → Application Access
//   EVERHOUR_SPREADSHEET_ID the <ID> from the quantified-self-everhour URL:
//                           https://docs.google.com/spreadsheets/d/<ID>/edit
//
// Time-based trigger: syncEverhour() daily at 23:45
// AFTER SETUP: run testEverhour() once from the editor — it probes each endpoint
// and logs the response shape, so you can confirm the API works with your account
// before trusting the nightly run.
// ─────────────────────────────────────────────────────────────────────────────

const EVERHOUR_BASE = "https://api.everhour.com";
const RATE_LIMIT_MAX = 20;       // requests per window
const RATE_LIMIT_WINDOW = 10000; // 10 seconds in ms
const LOOKBACK_DAYS = 2;         // pull last N days to catch late edits

// ── Secrets ─────────────────────────────────────────────────────────────────
// Read once from Script Properties so the real values never live in this file.
// Top-level code runs on every execution in this shared project (including
// syncTodoist), so only *read* here — never throw. Validation is in syncEverhour().
const EVERHOUR_API_KEY = PropertiesService.getScriptProperties().getProperty("EVERHOUR_API_KEY");
const EVERHOUR_SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty("EVERHOUR_SPREADSHEET_ID");

// One limiter per execution — Apps Script re-evaluates globals on every run, so
// each sync gets a fresh window.
const everhourLimiter = new RateLimiter(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW);

// Entry point — called by the daily time trigger
function syncEverhour() {
  if (!EVERHOUR_API_KEY || !EVERHOUR_SPREADSHEET_ID) {
    throw new Error(
      "Missing secrets. Set EVERHOUR_API_KEY and EVERHOUR_SPREADSHEET_ID in " +
      "Project Settings → Script Properties."
    );
  }
  // Run each step in isolation so one failure doesn't abort the others; surface
  // any failures at the end so they show in the Executions dashboard.
  const errors = [];
  try {
    const entries = fetchTimeEntries(LOOKBACK_DAYS);
    upsertTimeEntries(entries);
  } catch (e) { errors.push(`TimeEntries: ${e.message || e}`); Logger.log(`TimeEntries FAILED: ${e}`); }

  try {
    rebuildDailySummary(7); // recalculate last 7 days from whatever's in the sheet
  } catch (e) { errors.push(`DailySummary: ${e.message || e}`); Logger.log(`DailySummary FAILED: ${e}`); }

  if (errors.length) throw new Error("Some Everhour steps failed → " + errors.join(" | "));
}

// ── Time Entries ──────────────────────────────────────────────────────────────

// Pull time entries for the last daysBack days.
// Per the Apiary blueprint, /team/time returns TimeRecordExtended objects with a
// nested Task object by default — no embed param needed. We pass
// opts_include_billing=1 so the response includes a `billing` field
// (rate in cents/hour, billable boolean); if the API key isn't an admin, the
// param is ignored gracefully and billing fields stay blank.
function fetchTimeEntries(daysBack) {
  const projectMap = getEverhourProjectMap();
  const fromDate = toDateString(new Date(Date.now() - daysBack * 86400000));
  const toDate = toDateString(new Date());

  const entries = everhourGetPaged("/team/time", {
    from: fromDate,
    to: toDate,
    opts_include_billing: 1,
  });

  return entries.map(e => {
    const n = normalizeEntry(e);
    return { ...e, _norm: { ...n, project_name: projectMap[n.project_id] || "" } };
  });
}

// Extract IDs/names from a /team/time TimeRecordExtended entry, per blueprint:
//   { id, time, user (number), date, comment,
//     task: { id: "td:42"|"ev:..."|"as:...", name, projects: ["ev:..."], unbillable? },
//     billing?: { billable, rate, amount }   // only with opts_include_billing=1
//   }
// A task lives under one or more projects (it's an array) — we take the first
// as the primary project. The "td:" prefix marks Todoist-integrated tasks; we
// strip it into todoist_task_id so you can join directly to the Todoist
// Completions tab on a stable key.
function normalizeEntry(e) {
  const task = e.task || {};
  const projectIds = Array.isArray(task.projects) ? task.projects : [];
  const primaryProjectId = projectIds[0] || "";
  const taskId = task.id || "";
  const todoistMatch = taskId.match(/^td:(.+)$/);

  // Billable: prefer billing.billable when opts_include_billing=1 succeeded;
  // otherwise infer from task.unbillable (Everhour default is billable=true).
  const billingObj = e.billing || null;
  const isBillable = billingObj ? !!billingObj.billable : !task.unbillable;
  // Rate: only present with opts_include_billing=1 + admin permissions.
  // Blueprint specifies rate in cents per hour → convert to dollars per hour.
  const rate = billingObj && billingObj.rate ? billingObj.rate / 100 : "";

  return {
    user_id:         e.user != null ? String(e.user) : "",
    project_id:      primaryProjectId,
    project_name:    "", // filled by caller via projectMap
    task_id:         taskId,
    task_name:       task.name || "",
    billable:        isBillable ? "TRUE" : "FALSE",
    billable_rate:   rate,
    todoist_task_id: todoistMatch ? todoistMatch[1] : "",
  };
}

// Upsert entries into the TimeEntries tab by entry_id
function upsertTimeEntries(entries) {
  if (entries.length === 0) {
    Logger.log("TimeEntries: nothing to upsert");
    return;
  }

  const ss = SpreadsheetApp.openById(EVERHOUR_SPREADSHEET_ID);
  const sheet = ss.getSheetByName("TimeEntries");

  // Collect IDs to upsert
  const incomingIds = new Set(entries.map(e => String(e.id)));

  // Delete existing rows for these IDs (iterate bottom-up to preserve indices)
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (incomingIds.has(String(data[i][0]))) sheet.deleteRow(i + 1);
  }

  // Append all incoming entries fresh — column order must match schema-everhour.md:
  //   A entry_id  B date  C user_id  D project_id  E project_name  F task_id
  //   G task_name  H duration_seconds  I duration_minutes  J duration_hours
  //   K billable  L billable_rate  M notes  N synced_at  O todoist_task_id
  const now = new Date().toISOString();
  const rows = entries.map(e => {
    const n = e._norm || normalizeEntry(e);
    const seconds = e.time || 0;
    const minutes = seconds ? Math.round(seconds / 60) : 0;
    const hours = seconds ? Math.round((seconds / 3600) * 100) / 100 : 0;
    return [
      String(e.id),
      e.date || "",
      n.user_id,
      n.project_id,
      n.project_name,
      n.task_id,
      n.task_name,
      seconds,
      minutes,
      hours,
      n.billable,
      n.billable_rate,
      e.comment || "",
      now,
      n.todoist_task_id,
    ];
  });

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  Logger.log(`TimeEntries: upserted ${rows.length} entries`);
}

// ── Daily Summary ─────────────────────────────────────────────────────────────

// Rebuild DailySummary for the last rebuildDays from TimeEntries data
function rebuildDailySummary(rebuildDays) {
  const ss = SpreadsheetApp.openById(EVERHOUR_SPREADSHEET_ID);
  const entriesSheet = ss.getSheetByName("TimeEntries");
  const summarySheet = ss.getSheetByName("DailySummary");

  const cutoff = toDateString(new Date(Date.now() - rebuildDays * 86400000));

  // Aggregate TimeEntries in memory (column indices match the schema above)
  const entryData = entriesSheet.getDataRange().getValues();
  const byDate = {};

  for (let i = 1; i < entryData.length; i++) {
    const date = String(entryData[i][1]);       // B  date
    if (date < cutoff) continue;
    if (!byDate[date]) byDate[date] = { total: 0, billable: 0, projects: new Set(), count: 0 };
    const seconds = Number(entryData[i][7]) || 0; // H  duration_seconds
    const isBillable = entryData[i][10] === "TRUE"; // K  billable (was J before duration_minutes was added)
    const projectId = String(entryData[i][3]);    // D  project_id
    byDate[date].total += seconds;
    if (isBillable) byDate[date].billable += seconds;
    byDate[date].projects.add(projectId);
    byDate[date].count++;
  }

  // Delete existing rows in the rebuild window from DailySummary
  const summaryData = summarySheet.getDataRange().getValues();
  for (let i = summaryData.length - 1; i >= 1; i--) {
    if (String(summaryData[i][0]) >= cutoff) summarySheet.deleteRow(i + 1);
  }

  // Write fresh summary rows
  const now = new Date().toISOString();
  const rows = Object.entries(byDate).sort().map(([date, d]) => {
    const totalHours = Math.round((d.total / 3600) * 100) / 100;
    const billableHours = Math.round((d.billable / 3600) * 100) / 100;
    const nonBillableHours = Math.round(((d.total - d.billable) / 3600) * 100) / 100;
    const billablePct = d.total > 0 ? Math.round((d.billable / d.total) * 1000) / 10 : 0;
    return [date, totalHours, billableHours, nonBillableHours, billablePct, d.projects.size, d.count, now];
  });

  if (rows.length > 0) {
    summarySheet.getRange(summarySheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
  Logger.log(`DailySummary: rebuilt ${rows.length} days`);
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

// GET that:
//   - respects the Everhour rate limit on every call,
//   - throws a *legible* error when the response isn't JSON (HTTP error page,
//     deprecation notice, etc.), instead of a cryptic JSON.parse failure.
function everhourGet(path, params) {
  everhourLimiter.check();

  // Inline query builder (kept local to avoid name collisions with todoist-sync.gs
  // in the shared project namespace).
  const qs = params
    ? "?" + Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&")
    : "";

  const response = UrlFetchApp.fetch(`${EVERHOUR_BASE}${path}${qs}`, {
    headers: {
      "X-Api-Key": EVERHOUR_API_KEY,
      "Content-Type": "application/json",
    },
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  const body = response.getContentText();
  if (code >= 300) {
    throw new Error(`Everhour GET ${path} → HTTP ${code}: ${body.slice(0, 200)}`);
  }
  const trimmed = (body || "").trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    throw new Error(`Everhour GET ${path} returned non-JSON: ${trimmed.slice(0, 200)}`);
  }
  return JSON.parse(trimmed);
}

// Page-based pagination (Everhour uses ?page=1,2,... with ?limit=100).
function everhourGetPaged(path, params) {
  const limit = 100;
  let all = [];
  let page = 1;
  while (page <= 200) { // guard
    const items = everhourGet(path, { ...(params || {}), page, limit });
    if (!Array.isArray(items) || items.length === 0) break;
    all = all.concat(items);
    if (items.length < limit) break;
    page++;
  }
  return all;
}

// ── Lookups (cached 6h) ─────────────────────────────────────────────────────

// Resolve Everhour project IDs → names
function getEverhourProjectMap() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("EVERHOUR_PROJECT_MAP");
  if (cached) return JSON.parse(cached);

  const projects = everhourGetPaged("/projects");
  const map = {};
  projects.forEach(p => { map[String(p.id)] = p.name; });
  cache.put("EVERHOUR_PROJECT_MAP", JSON.stringify(map), 21600); // 6h
  return map;
}

// ── Small helpers ─────────────────────────────────────────────────────────────

// Rate limiter: tracks timestamps of recent requests; sleeps if window is full
function RateLimiter(maxRequests, windowMs) {
  const timestamps = [];
  this.check = function () {
    const now = Date.now();
    while (timestamps.length > 0 && now - timestamps[0] > windowMs) timestamps.shift();
    if (timestamps.length >= maxRequests) {
      const sleepMs = windowMs - (now - timestamps[0]) + 50;
      Utilities.sleep(sleepMs);
      timestamps.length = 0;
    }
    timestamps.push(Date.now());
  };
}

// Format a Date as YYYY-MM-DD
function toDateString(date) {
  return date.toISOString().split("T")[0];
}

// ── Diagnostics ───────────────────────────────────────────────────────────────
// Run this once from the editor after setting the Script Properties. It hits
// each endpoint with limit=1 and logs the response shape, so you can confirm
// the API works for your account before trusting the nightly run.
function testEverhour() {
  if (!EVERHOUR_API_KEY) throw new Error("Set EVERHOUR_API_KEY in Script Properties first.");
  const shape = r => Array.isArray(r)
    ? `array[${r.length}]`
    : (r && typeof r === "object" ? `object keys: {${Object.keys(r).join(", ")}}` : String(r));
  const probe = (label, fn) => {
    try { Logger.log(`✓ ${label} → ${shape(fn())}`); }
    catch (e) { Logger.log(`✗ ${label} → ${e}`); }
  };

  const from = toDateString(new Date(Date.now() - 2 * 86400000));
  const to = toDateString(new Date());
  probe("GET /projects", () => everhourGet("/projects", { limit: 1 }));
  probe("GET /team/time", () => everhourGet("/team/time", { from, to, limit: 1 }));
}

// Dump the full JSON of one project and one time entry to the log, so we can
// confirm exact field names (especially how `user`, `project`, `task` are shaped,
// and where Todoist task IDs live when the Everhour ↔ Todoist integration is on).
// Run this from the editor and share the log if any column comes back blank.
function dumpEverhourSample() {
  if (!EVERHOUR_API_KEY) throw new Error("Set EVERHOUR_API_KEY in Script Properties first.");
  const from = toDateString(new Date(Date.now() - 14 * 86400000));
  const to = toDateString(new Date());

  try {
    const projects = everhourGet("/projects", { limit: 1 });
    Logger.log("Sample /projects[0]:\n" + JSON.stringify(projects[0] || projects, null, 2));
  } catch (e) { Logger.log("projects sample failed: " + e); }

  try {
    const entries = everhourGet("/team/time", { from, to, limit: 1 });
    Logger.log("Sample /team/time[0] (default):\n" + JSON.stringify(entries[0] || entries, null, 2));
    const withBilling = everhourGet("/team/time", { from, to, limit: 1, opts_include_billing: 1 });
    Logger.log("Sample /team/time[0] (with opts_include_billing=1):\n" + JSON.stringify(withBilling[0] || withBilling, null, 2));
  } catch (e) { Logger.log("time-entries sample failed: " + e); }
}
