# Shortcut: Morning Summary

**Trigger**: Personal Automation → "When morning alarm is dismissed"  
**Output**: Writes a markdown metrics block to `_qs-summary.md` in your Obsidian vault (iCloud)

This is the Shortcut that powers **Option C** of the Obsidian integration. It reads yesterday's data from your four Google Sheets and writes a formatted summary that your Obsidian daily note template picks up automatically.

---

## Prerequisites

- Google Sheets API enabled and the Apps Script webhook already running
- Your four Google Sheets created and populated with at least one day of data
- Obsidian vault stored in iCloud Drive

---

## Steps

```
1. [Get Current Date] → store as "today"
   [Calculate] → today minus 1 day → store as "yesterday"
   [Format Date] → yesterday, format "YYYY-MM-DD" → store as "date_str"

2. ── Read from Google Sheets ──────────────────────────────────────────
   You need the Google Sheets API key or use the Sheets URL with your
   Google account. The simplest method is to use a dedicated Apps Script
   endpoint that returns a JSON summary for a given date.
   
   [Get Contents of URL]
   - URL: <your Apps Script summary endpoint>?date=[date_str]
   - Method: GET
   - Store result as "raw_json"

3. [Get Dictionary Value] from raw_json:
   - "mood_avg"        → store as "mood"
   - "sleep_hours"     → store as "sleep"
   - "hrv_ms"          → store as "hrv"
   - "habits_done"     → store as "habits"
   - "habits_total"    → store as "habits_total"
   - "hours_worked"    → store as "hours"
   - "billable_hours"  → store as "billable"
   - "karma_score"     → store as "karma"
   - "karma_delta"     → store as "karma_delta"

4. ── Build the markdown block ──────────────────────────────────────────
   [Text]
   ## Quantified Self — [date_str]
   
   | Metric | Value |
   |---|---|
   | Mood (avg) | [mood] / 5 |
   | Sleep | [sleep] h |
   | HRV | [hrv] ms |
   | Habits | [habits] / [habits_total] |
   | Hours tracked | [hours] h ([billable] billable) |
   | Karma | [karma] ([karma_delta]) |
   
   → store as "summary_md"

5. ── Write to Obsidian vault via iCloud ────────────────────────────────
   [Save File]
   - File: [summary_md]
   - Destination: iCloud Drive
   - Path: Obsidian/<your-vault-name>/_qs-summary.md
   - Overwrite: ON

6. [Speak Text] → "Good morning. Your summary is ready."
```

---

## Apps Script summary endpoint

Add this function to your `apps-script.gs` (the existing webhook) or to a new bound script on `quantified-self-log`. It reads across all four sheets and returns a single JSON summary for a given date:

```javascript
function doGet(e) {
  const date = e.parameter.date || toDateString(new Date(Date.now() - 86400000));

  const logSS    = SpreadsheetApp.openById("<LOG_SHEET_ID>");
  const healthSS = SpreadsheetApp.openById("<HEALTH_SHEET_ID>");
  const todoSS   = SpreadsheetApp.openById("<TODOIST_SHEET_ID>");
  const ehSS     = SpreadsheetApp.openById("<EVERHOUR_SHEET_ID>");

  // Mood average from Log tab
  const logData = logSS.getSheetByName("Log").getDataRange().getValues();
  const moods = logData.filter(r => r[0].toString().startsWith(date) && r[1] === "mood")
                       .map(r => Number(r[2])).filter(v => !isNaN(v));
  const moodAvg = moods.length > 0 ? (moods.reduce((a, b) => a + b) / moods.length).toFixed(1) : "—";

  // Sleep + HRV from Health tab
  const healthData = healthSS.getSheetByName("Health").getDataRange().getValues();
  const healthRow = healthData.find(r => r[0] === date) || [];

  // Habits from Todoist Completions. A habit is a recurring completion explicitly tagged
  // `habits` — a positive filter, so anything untagged fails to count instead of silently
  // inflating the total. Checklist steps are undated subtasks that Todoist resets when the
  // parent recurs, so they are not recurring and cannot land here anyway; the label test is
  // the guard for the day someone gives one a recurrence.
  // Exact token match matters here: `sub-habits` contains "habits" as a substring.
  const completionsData = todoSS.getSheetByName("Completions").getDataRange().getValues();
  const habitsForDate = completionsData.filter(r =>
    r[0].toString().startsWith(date) &&
    r[8] === "TRUE" &&
    r[6].toString().split(",").map(s => s.trim()).indexOf("habits") !== -1);

  // Hours from Everhour DailySummary
  const ehData = ehSS.getSheetByName("DailySummary").getDataRange().getValues();
  const ehRow = ehData.find(r => r[0] === date) || [];

  // Karma from Todoist KarmaStats
  const karmaData = todoSS.getSheetByName("KarmaStats").getDataRange().getValues();
  const karmaRow = karmaData.find(r => r[0] === date) || [];

  const summary = {
    date,
    mood_avg:       moodAvg,
    sleep_hours:    healthRow[2] || "—",
    hrv_ms:         healthRow[5] || "—",
    habits_done:    habitsForDate.length,
    habits_total:   "?",   // set a fixed target or derive from a config tab
    hours_worked:   ehRow[1] || 0,
    billable_hours: ehRow[2] || 0,
    karma_score:    karmaRow[1] || "—",
    karma_delta:    karmaRow[2] || "—",
  };

  return ContentService
    .createTextOutput(JSON.stringify(summary))
    .setMimeType(ContentService.MimeType.JSON);
}

function toDateString(date) {
  return date.toISOString().split("T")[0];
}
```

Deploy this as a **Web App** (Execute as: Me, Access: Anyone with Google account) and use the resulting URL in step 2 of the Shortcut above.

---

## Notes

- The Shortcut overwrites `_qs-summary.md` each morning — Obsidian daily notes from previous days keep the snapshot that was injected at note creation time (Templater reads the file once on creation)
- If you dismiss your alarm before the nightly sync has run (e.g. at 00:30), `date_str` will be two days ago — the data will still be correct since it reads from the sheets by date
- To test without dismissing an alarm: run the Shortcut manually from the Shortcuts app
