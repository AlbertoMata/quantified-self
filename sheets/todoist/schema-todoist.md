# Sheet Schema — Todoist

Google Sheet name: `quantified-self-todoist`  
Populated by: `sheets/todoist-sync.gs` (standalone Apps Script, nightly trigger at 23:30)

Three tabs, each capturing a different shape of Todoist data.

---

## Tab 1: `Completions`

One row per completed task (both one-off and recurring). The `is_recurring` flag distinguishes habits from one-off work.

**Event sources**: Captures completions from three sources:
1. One-off completions — `/tasks/completed/by_completion_date`, which returns full task objects (labels, project, section, due, duration, parent). Recurring tasks never appear here.
2. Recurring check-offs — activity log (`/activities`, `event_type=completed`) filtered to `is_recurring`; these carry their labels in `extra_data`.
3. Tasks currently in an "In Review" section of a target project (Fullsteam, Ascensus, Work) — treated as PR/story ready state.

Sources 1 and 2 are **disjoint by construction** (a task is either recurring or not), so labels — and therefore `complexity`, a numeric-only label — populate for both task types without a fragile cross-endpoint `task_id` join.

**Deduplication key**: `task_id|completed_at` for sources 1–2; an entered-since-last-run snapshot diff for source 3.  
**Strategy**: incremental append — only completions since the last sync cursor are fetched. The composite key handles recurring tasks (same `task_id`, different timestamps).

**Why "In Review" is a snapshot diff, not an event**: the Todoist v1 activity log does **not** expose `section_id` on `item:updated` events (verified live — `extra_data` carries only content/description deltas), so a *move* into In Review is undetectable from the event stream. Instead the sync snapshots the current In Review membership each run and records **only the tasks that entered since the last run** (current − previous), with `completed_at` set to the detection time (the API gives no actual move timestamp). The previous membership is stored in the `TODOIST_IN_REVIEW_PREV` Script Property and updated only after the rows are written. This means a task is counted on the day it moves into In Review, and **again** if it later leaves and re-enters. Caveats: (a) a task that moves into In Review and back out between nightly runs is missed; (b) on the very first run the previous set is empty, so every task currently in In Review is backfilled with that day's date (delete those rows manually if you only want true go-forward moves).

| # | Column | Type | Example | Notes |
|---|---|---|---|---|
| A | `completed_at` | ISO 8601 UTC | `2026-05-23T09:14:00Z` | Completion timestamp |
| B | `task_id` | string | `8284945872` | Todoist task ID — part of composite dedup key |
| C | `task_content` | string | `Morning workout` | Task title |
| D | `project_id` | string | `2203306141` | Parent project ID |
| E | `project_name` | string | `Health` | Resolved via project map (cached) |
| F | `section_name` | string | `Daily habits` | Empty if task has no section; "In Review" for section movement events |
| G | `labels` | string | `habit,health` | Comma-separated label names, carried directly by each source |
| H | `priority` | integer 1–4 | `2` | 1=normal, 4=urgent |
| I | `is_recurring` | boolean | `TRUE` | TRUE if task has a recurrence rule |
| J | `due_date` | YYYY-MM-DD | `2026-05-23` | Original due date (for streak tracking) |
| K | `duration_minutes` | integer | `30` | Task duration if set; empty otherwise |
| L | `sync_date` | YYYY-MM-DD | `2026-05-23` | Date the sync script ran |
| M | `parent_id` | string | `8284123456` | Todoist parent task ID; empty for top-level tasks. Self-blend on `parent_id ↔ task_id` to attach parent details |
| N | `complexity` | integer | `5` | Story points/complexity: derived from the first numeric-only label (see col G); empty if none. Recurring tasks rarely have one, so this is mostly populated for dev/work tasks |

**Header row:**
```
completed_at	task_id	task_content	project_id	project_name	section_name	labels	priority	is_recurring	due_date	duration_minutes	sync_date	parent_id	complexity
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
| J | `parent_id` | string | `8284123456` | Todoist parent task ID; empty for top-level tasks. Self-blend on `parent_id ↔ task_id` (any Todoist tab) to attach parent details |

**Header row:**
```
snapshot_date	task_id	task_content	project_name	labels	due_date	days_overdue	priority	is_recurring	parent_id
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
- Filter `section_name = "In Review"` to track story/PR completions separately from task completions
- Use `complexity` to aggregate story points completed per sprint/period — join with time data for velocity tracking
- Join `KarmaStats` with the `Health` sheet on `date` to correlate productivity with sleep/HRV
- The `Overdue` tab is useful as a bar chart over time: aggregate `days_overdue` per week to spot periods of backlog accumulation
- **Parent task self-blend:** join `Completions.parent_id ↔ Completions.task_id` (alias the right side as `parent`) to attach the parent's title, project, or labels to every subtask completion. Works the same on `Overdue.parent_id`
- **Time per parent task:** chain blends — `quantified-self-everhour!TimeEntries.todoist_task_id ↔ Completions.task_id`, then `Completions.parent_id ↔ Completions.task_id` — to sum Everhour minutes per parent task without touching the Everhour script
