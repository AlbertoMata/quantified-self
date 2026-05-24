// ─────────────────────────────────────────────────────────────────────────────
// Everhour Sync — quantified-self-sync (standalone Apps Script project)
//
// Required Script Properties (Project Settings → Script Properties):
//   EVERHOUR_API_KEY        API key from Everhour → My Profile → Settings → Application Access
//   EVERHOUR_SPREADSHEET_ID Google Sheets ID of quantified-self-everhour
//
// Time-based trigger: syncEverhour() daily at 23:45
// ─────────────────────────────────────────────────────────────────────────────

const EVERHOUR_BASE = "https://api.everhour.com/v1";
const RATE_LIMIT_MAX = 20;    // requests per window
const RATE_LIMIT_WINDOW = 10000; // 10 seconds in ms
const LOOKBACK_DAYS = 2;      // pull last N days to catch late edits

// Entry point — called by the daily time trigger
function syncEverhour() {
  const entries = fetchTimeEntries(LOOKBACK_DAYS);
  upsertTimeEntries(entries);
  rebuildDailySummary(7); // recalculate last 7 days
}

// ── Time Entries ──────────────────────────────────────────────────────────────

// Pull time entries for the last daysBack days
function fetchTimeEntries(daysBack) {
  const apiKey = requireProperty("EVERHOUR_API_KEY");
  const limiter = new RateLimiter(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW);
  const projectMap = getEverhourProjectMap(apiKey, limiter);

  const fromDate = toDateString(new Date(Date.now() - daysBack * 86400000));
  const toDate = toDateString(new Date());

  let entries = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    limiter.check();
    const response = UrlFetchApp.fetch(
      `${EVERHOUR_BASE}/team/time?from=${fromDate}&to=${toDate}&page=${page}&limit=100`,
      {
        headers: {
          "X-Api-Key": apiKey,
          "Content-Type": "application/json",
        },
        muteHttpExceptions: true,
      }
    );

    const items = JSON.parse(response.getContentText());
    if (!Array.isArray(items) || items.length === 0) break;

    entries = entries.concat(items);
    hasMore = items.length === 100;
    page++;
  }

  // Enrich with resolved project names
  return entries.map(e => ({
    ...e,
    project_name: projectMap[e.projectId] || "",
  }));
}

// Upsert entries into the TimeEntries tab by entry_id
function upsertTimeEntries(entries) {
  const ss = SpreadsheetApp.openById(requireProperty("EVERHOUR_SPREADSHEET_ID"));
  const sheet = ss.getSheetByName("TimeEntries");

  if (entries.length === 0) return;

  // Collect IDs to upsert
  const incomingIds = new Set(entries.map(e => String(e.id)));

  // Delete existing rows for these IDs (iterate bottom-up to preserve indices)
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (incomingIds.has(String(data[i][0]))) {
      sheet.deleteRow(i + 1);
    }
  }

  // Append all incoming entries fresh
  const now = new Date().toISOString();
  const rows = entries.map(e => {
    const durationHours = e.time ? Math.round((e.time / 3600) * 100) / 100 : 0;
    return [
      String(e.id),
      e.date || "",
      String(e.userId || ""),
      String(e.projectId || ""),
      e.project_name,
      String(e.taskId || ""),
      e.task ? (e.task.name || "") : "",
      e.time || 0,
      durationHours,
      e.billable ? "TRUE" : "FALSE",
      e.rate ? e.rate : "",
      e.comment || "",
      now,
    ];
  });

  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
  Logger.log(`TimeEntries: upserted ${rows.length} entries`);
}

// ── Daily Summary ─────────────────────────────────────────────────────────────

// Rebuild DailySummary for the last rebuildDays from TimeEntries data
function rebuildDailySummary(rebuildDays) {
  const ss = SpreadsheetApp.openById(requireProperty("EVERHOUR_SPREADSHEET_ID"));
  const entriesSheet = ss.getSheetByName("TimeEntries");
  const summarySheet = ss.getSheetByName("DailySummary");

  // Build date window
  const cutoff = toDateString(new Date(Date.now() - rebuildDays * 86400000));

  // Aggregate TimeEntries in memory
  const entryData = entriesSheet.getDataRange().getValues();
  const byDate = {};

  for (let i = 1; i < entryData.length; i++) {
    const date = String(entryData[i][1]); // column B
    if (date < cutoff) continue;
    if (!byDate[date]) byDate[date] = { total: 0, billable: 0, projects: new Set(), count: 0 };
    const seconds = Number(entryData[i][7]) || 0; // column H
    const isBillable = entryData[i][9] === "TRUE"; // column J
    const projectId = String(entryData[i][3]); // column D
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

// ── Helpers ───────────────────────────────────────────────────────────────────

// Resolve Everhour project IDs → names; cached for 6h
function getEverhourProjectMap(apiKey, limiter) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("EVERHOUR_PROJECT_MAP");
  if (cached) return JSON.parse(cached);

  limiter.check();
  const response = UrlFetchApp.fetch(`${EVERHOUR_BASE}/projects`, {
    headers: { "X-Api-Key": apiKey },
    muteHttpExceptions: true,
  });
  const projects = JSON.parse(response.getContentText());
  const map = {};
  if (Array.isArray(projects)) {
    projects.forEach(p => { map[String(p.id)] = p.name; });
  }
  cache.put("EVERHOUR_PROJECT_MAP", JSON.stringify(map), 21600); // 6h
  return map;
}

// Rate limiter: tracks timestamps of recent requests; sleeps if window is full
function RateLimiter(maxRequests, windowMs) {
  const timestamps = [];
  this.check = function () {
    const now = Date.now();
    // Remove timestamps outside the window
    while (timestamps.length > 0 && now - timestamps[0] > windowMs) timestamps.shift();
    if (timestamps.length >= maxRequests) {
      const sleepMs = windowMs - (now - timestamps[0]) + 50;
      Utilities.sleep(sleepMs);
      timestamps.length = 0; // reset after sleeping
    }
    timestamps.push(Date.now());
  };
}

// Throw clearly if a required Script Property is missing
function requireProperty(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error(`Missing Script Property: ${key}. Set it in Project Settings → Script Properties.`);
  return value;
}

// Format a Date as YYYY-MM-DD
function toDateString(date) {
  return date.toISOString().split("T")[0];
}
