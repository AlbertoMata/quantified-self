# Sheet Schema — Todoist

Google Sheet name: `quantified-self-todoist`  
Populated by: `sheets/todoist-sync.gs` (standalone Apps Script, nightly trigger at 23:30)

Three tabs, each capturing a different shape of Todoist data.

---

## Tab 1: `Completions`

One row per completed task (both one-off and recurring). The `is_recurring` flag distinguishes habits from one-off work.

**Deduplication key**: `task_id`  
**Strategy**: incremental append — only tasks completed since the last sync cursor are fetched.

| # | Column | Type | Example | Notes |
|---|---|---|---|---|
| A | `completed_at` | ISO 8601 UTC | `2026-05-23T09:14:00Z` | Completion timestamp |
| B | `task_id` | string | `8284945872` | Todoist task ID — stable dedup key |
| C | `task_content` | string | `Morning workout` | Task title |
| D | `project_id` | string | `2203306141` | Parent project ID |
| E | `project_name` | string | `Health` | Resolved via project map (cached) |
| F | `section_name` | string | `Daily habits` | Empty if task has no section |
| G | `labels` | string | `habit,health` | Comma-separated label names |
| H | `priority` | integer 1–4 | `2` | 1=normal, 4=urgent |
| I | `is_recurring` | boolean | `TRUE` | TRUE if task has a recurrence rule |
| J | `due_date` | YYYY-MM-DD | `2026-05-23` | Original due date (for streak tracking) |
| K | `duration_minutes` | integer | `30` | Task duration if set; empty otherwise |
| L | `sync_date` | YYYY-MM-DD | `2026-05-23` | Date the sync script ran |

**Header row:**
```
completed_at	task_id	task_content	project_id	project_name	section_name	labels	priority	is_recurring	due_date	duration_minutes	sync_date
```

---

## Tab 2: `Overdue`

Daily snapshot of tasks that were due but not completed. The sync script **replaces** today's rows on each run (not appended) — overdue is a state, not an event log.

**Strategy**: full daily replace — delete all rows where `snapshot_date = today`, then write fresh.

| # | Column | Type | Example | Notes |
|---|---|---|---|---|
| A | `snapshot_date` | YYYY-MM-DD | `2026-05-23` | Date this snapshot was taken |
| B | `task_id` | string | `8284945872` | |
| C | `task_content` | string | `Review weekly goals` | |
| D | `project_name` | string | `Work` | |
| E | `labels` | string | `habit` | |
| F | `due_date` | YYYY-MM-DD | `2026-05-21` | When the task was due |
| G | `days_overdue` | integer | `2` | snapshot_date − due_date |
| H | `priority` | integer 1–4 | `3` | |
| I | `is_recurring` | boolean | `TRUE` | |

**Header row:**
```
snapshot_date	task_id	task_content	project_name	labels	due_date	days_overdue	priority	is_recurring
```

---

## Tab 3: `KarmaStats`

One row per day capturing Todoist's productivity metrics. Deduplication on `date` — if the row already exists for today, update it in place.

**Deduplication key**: `date`

| # | Column | Type | Example | Notes |
|---|---|---|---|---|
| A | `date` | YYYY-MM-DD | `2026-05-23` | Stats date — dedup key |
| B | `karma_score` | integer | `15420` | Total karma at time of sync |
| C | `karma_delta` | integer | `42` | Change from the previous day's score |
| D | `tasks_completed` | integer | `8` | Total completions for the day |
| E | `tasks_added` | integer | `3` | Tasks created that day |
| F | `streak_days` | integer | `14` | Current daily completion streak |
| G | `sync_date` | YYYY-MM-DD | `2026-05-23` | When the sync ran |

**Header row:**
```
date	karma_score	karma_delta	tasks_completed	tasks_added	streak_days	sync_date
```

---

## Script Properties required

Set these in the Apps Script project (**Project Settings → Script Properties**):

| Key | Value |
|---|---|
| `TODOIST_TOKEN` | Bearer token from [todoist.com/app/settings/integrations/developer](https://todoist.com/app/settings/integrations/developer) |
| `TODOIST_SPREADSHEET_ID` | ID from the Google Sheets URL: `docs.google.com/spreadsheets/d/<ID>/edit` |

---

## Tips

- Filter `Completions` to `is_recurring = TRUE` in Looker Studio for a pure habits view
- Join `KarmaStats` with the `Health` sheet on `date` to correlate productivity with sleep/HRV
- The `Overdue` tab is useful as a bar chart over time: aggregate `days_overdue` per week to spot periods of backlog accumulation
