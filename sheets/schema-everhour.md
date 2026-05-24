# Sheet Schema — Everhour

Google Sheet name: `quantified-self-everhour`  
Populated by: `sheets/everhour-sync.gs` (standalone Apps Script, nightly trigger at 23:45)

Two tabs: raw time entries and a daily summary rebuilt from them each sync.

---

## Tab 1: `TimeEntries`

One row per time entry logged in Everhour. The sync pulls the last 2 days on each run to catch late edits, then upserts by `entry_id`.

**Deduplication key**: `entry_id`  
**Strategy**: upsert — delete existing rows matching `entry_id`, re-append with fresh data. Handles entries edited after initial sync.

| # | Column | Type | Example | Notes |
|---|---|---|---|---|
| A | `entry_id` | string | `abc123` | Everhour entry ID — stable dedup key |
| B | `date` | YYYY-MM-DD | `2026-05-23` | Date the time was worked — join key |
| C | `user_id` | string | `12345` | Everhour user ID |
| D | `project_id` | string | `proj_789` | Everhour project ID |
| E | `project_name` | string | `Client XYZ` | Resolved project name |
| F | `task_id` | string | `task_456` | Everhour task ID |
| G | `task_name` | string | `Design mockups` | Task title |
| H | `duration_seconds` | integer | `3600` | Raw duration from API |
| I | `duration_hours` | decimal | `1.00` | Computed: seconds / 3600 (2 dp) |
| J | `billable` | boolean | `TRUE` | Billable flag from Everhour |
| K | `billable_rate` | decimal | `85.00` | Hourly rate if billable; empty otherwise |
| L | `notes` | string | `Initial wireframes` | Entry comment |
| M | `synced_at` | ISO 8601 | `2026-05-23T23:45:00Z` | When the sync script ran |

**Header row:**
```
entry_id	date	user_id	project_id	project_name	task_id	task_name	duration_seconds	duration_hours	billable	billable_rate	notes	synced_at
```

---

## Tab 2: `DailySummary`

Aggregated per-day totals, rebuilt in Apps Script from `TimeEntries` for the last 7 days on every sync. Upserted by `date`.

**Deduplication key**: `date`  
**Strategy**: recalculate last 7 days in GAS memory, delete those rows from the sheet, re-append. Keeps the summary consistent with any edits to `TimeEntries`.

| # | Column | Type | Example | Notes |
|---|---|---|---|---|
| A | `date` | YYYY-MM-DD | `2026-05-23` | Join key across all sheets |
| B | `total_hours` | decimal | `6.50` | Total hours tracked |
| C | `billable_hours` | decimal | `4.00` | Billable subset |
| D | `non_billable_hours` | decimal | `2.50` | Non-billable subset |
| E | `billable_pct` | decimal | `61.5` | billable_hours / total_hours × 100 |
| F | `project_count` | integer | `3` | Distinct projects touched |
| G | `entry_count` | integer | `7` | Number of time entries |
| H | `synced_at` | ISO 8601 | `2026-05-23T23:45:00Z` | When this summary was computed |

**Header row:**
```
date	total_hours	billable_hours	non_billable_hours	billable_pct	project_count	entry_count	synced_at
```

---

## Script Properties required

Set these in the Apps Script project (**Project Settings → Script Properties**):

| Key | Value |
|---|---|
| `EVERHOUR_API_KEY` | API key from Everhour → My Profile → Settings → Application Access |
| `EVERHOUR_SPREADSHEET_ID` | ID from the Google Sheets URL |

Everhour API base URL: `https://api.everhour.com/v1`  
Rate limit: ~20 requests per 10 seconds — the sync script handles this automatically via `RateLimiter`.

---

## Tips

- `DailySummary.date` is the recommended join key when blending with other sheets in Looker Studio
- Create a Looker Studio scorecard for `billable_pct` as a rolling 7-day average to track billing efficiency
- Blend `DailySummary` with `quantified-self-log` focus blocks (`event_type = focus_end`) on `date` to compare logged focus time vs billed time
