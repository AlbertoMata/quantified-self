// ─────────────────────────────────────────────────────────────────────────────
// Todoist Sync — quantified-self-sync (standalone Apps Script project)
//
// Required Script Properties (Project Settings → Script Properties):
//   TODOIST_TOKEN           Bearer token from Todoist integrations page
//   TODOIST_SPREADSHEET_ID  Google Sheets ID of quantified-self-todoist
//
// Time-based trigger: syncTodoist() daily at 23:30
// ─────────────────────────────────────────────────────────────────────────────

const TODOIST_BASE = "https://api.todoist.com/rest/v2";

// Entry point — called by the daily time trigger
function syncTodoist() {
  syncCompletions();
  syncOverdue();
  syncKarmaStats();
}

// ── Completions ───────────────────────────────────────────────────────────────

function syncCompletions() {
  const token = requireProperty("TODOIST_TOKEN");
  const ss = SpreadsheetApp.openById(requireProperty("TODOIST_SPREADSHEET_ID"));
  const sheet = ss.getSheetByName("Completions");

  const since = getLastSyncTime();
  const projectMap = getProjectMap(token);
  const existingIds = getExistingIds(sheet, 2); // column B = task_id

  // Todoist REST v2: filter completed tasks since last sync
  const params = { filter: `completed after:${since}` };
  const tasks = fetchTodoistPaged("/tasks", params, token);

  const rows = tasks
    .filter(t => !existingIds.has(t.id))
    .map(t => [
      t.completed_at || new Date().toISOString(),
      t.id,
      t.content,
      t.project_id || "",
      projectMap[t.project_id] || "",
      t.section_id ? (getSectionName(t.section_id, token) || "") : "",
      (t.labels || []).join(","),
      t.priority,
      t.due && t.due.is_recurring ? "TRUE" : "FALSE",
      t.due ? t.due.date : "",
      t.duration ? Math.round(t.duration.amount * (t.duration.unit === "hour" ? 60 : 1)) : "",
      toDateString(new Date()),
    ]);

  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }

  setLastSyncTime(new Date().toISOString());
  Logger.log(`Completions: appended ${rows.length} new rows`);
}

// ── Overdue ───────────────────────────────────────────────────────────────────

function syncOverdue() {
  const token = requireProperty("TODOIST_TOKEN");
  const ss = SpreadsheetApp.openById(requireProperty("TODOIST_SPREADSHEET_ID"));
  const sheet = ss.getSheetByName("Overdue");

  const today = toDateString(new Date());

  // Delete today's existing snapshot rows (column A = snapshot_date)
  const data = sheet.getDataRange().getValues();
  const rowsToDelete = [];
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === today) rowsToDelete.push(i + 1);
  }
  rowsToDelete.forEach(r => sheet.deleteRow(r));

  // Fetch all active tasks that are overdue
  const tasks = fetchTodoistPaged("/tasks", { filter: "overdue" }, token);
  const projectMap = getProjectMap(token);

  const todayMs = new Date(today).getTime();
  const rows = tasks.map(t => {
    const dueDate = t.due ? t.due.date : "";
    const dueDateMs = dueDate ? new Date(dueDate).getTime() : todayMs;
    const daysOverdue = Math.floor((todayMs - dueDateMs) / 86400000);
    return [
      today,
      t.id,
      t.content,
      projectMap[t.project_id] || "",
      (t.labels || []).join(","),
      dueDate,
      daysOverdue,
      t.priority,
      t.due && t.due.is_recurring ? "TRUE" : "FALSE",
    ];
  });

  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
  Logger.log(`Overdue: wrote ${rows.length} rows for ${today}`);
}

// ── Karma Stats ───────────────────────────────────────────────────────────────

function syncKarmaStats() {
  const token = requireProperty("TODOIST_TOKEN");
  const ss = SpreadsheetApp.openById(requireProperty("TODOIST_SPREADSHEET_ID"));
  const sheet = ss.getSheetByName("KarmaStats");

  const today = toDateString(new Date());
  const existingDates = getExistingIds(sheet, 1); // column A = date

  // Todoist Sync API for karma/stats (not available in REST v2)
  const syncResponse = UrlFetchApp.fetch("https://api.todoist.com/sync/v9/sync", {
    method: "post",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    payload: "sync_token=*&resource_types=[%22user%22%2C%22stats%22]",
    muteHttpExceptions: true,
  });

  const syncData = JSON.parse(syncResponse.getContentText());
  const stats = syncData.stats || {};
  const user = syncData.user || {};

  const karma = user.karma || 0;
  const dailyGoal = stats.days_items || [];
  const todayStats = dailyGoal.find(d => d.date === today) || {};

  // Calculate karma delta from yesterday's row
  let karmaDelta = 0;
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const prevKarma = sheet.getRange(lastRow, 2).getValue();
    karmaDelta = karma - prevKarma;
  }

  if (existingDates.has(today)) {
    // Update existing row for today
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === today) {
        sheet.getRange(i + 1, 1, 1, 7).setValues([[
          today, karma, karmaDelta,
          todayStats.total_completed || 0,
          todayStats.total_added || 0,
          user.karma_trend ? user.karma_trend : "",
          today,
        ]]);
        break;
      }
    }
  } else {
    sheet.appendRow([
      today, karma, karmaDelta,
      todayStats.total_completed || 0,
      todayStats.total_added || 0,
      "",
      today,
    ]);
  }
  Logger.log(`KarmaStats: recorded karma=${karma} delta=${karmaDelta} for ${today}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Paginated GET from Todoist REST API — returns flat array of results
function fetchTodoistPaged(endpoint, params, token) {
  let results = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const qs = Object.entries({ ...params, page })
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const response = UrlFetchApp.fetch(`${TODOIST_BASE}${endpoint}?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
      muteHttpExceptions: true,
    });

    const items = JSON.parse(response.getContentText());
    if (!Array.isArray(items) || items.length === 0) break;

    results = results.concat(items);
    hasMore = items.length === 200;
    page++;
    if (hasMore) Utilities.sleep(500); // courtesy delay between pages
  }

  return results;
}

// Resolve project IDs → names; cached for 6h to reduce API calls
function getProjectMap(token) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("TODOIST_PROJECT_MAP");
  if (cached) return JSON.parse(cached);

  const response = UrlFetchApp.fetch(`${TODOIST_BASE}/projects`, {
    headers: { Authorization: `Bearer ${token}` },
    muteHttpExceptions: true,
  });
  const projects = JSON.parse(response.getContentText());
  const map = {};
  projects.forEach(p => { map[p.id] = p.name; });
  cache.put("TODOIST_PROJECT_MAP", JSON.stringify(map), 21600); // 6h
  return map;
}

// Fetch section name by ID (not cached — called rarely)
function getSectionName(sectionId, token) {
  const response = UrlFetchApp.fetch(`${TODOIST_BASE}/sections/${sectionId}`, {
    headers: { Authorization: `Bearer ${token}` },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) return "";
  return JSON.parse(response.getContentText()).name || "";
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
  const props = PropertiesService.getScriptProperties();
  return props.getProperty("TODOIST_LAST_SYNC") || "2000-01-01T00:00:00Z";
}

function setLastSyncTime(isoTimestamp) {
  PropertiesService.getScriptProperties().setProperty("TODOIST_LAST_SYNC", isoTimestamp);
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
