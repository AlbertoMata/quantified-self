# Sheet Schema — Todoist

Google Sheet name: `quantified-self-todoist`  
Populated by: the standalone Apps Script project in `sheets/todoist/` — entry point `syncTodoist()` in `todoist-sync.gs` (nightly trigger at 23:30)

Five tabs, each capturing a different shape of Todoist data. The first four are fetched from the Todoist API; `HabitDaily` is derived from the other tabs (only its one-time history synthesizer touches the API, to read each habit's `added_at`).

---

## Tab 1: `Completions`

One row per completed task (both one-off and recurring). The `is_recurring` flag distinguishes recurring work from one-off work. A tracked habit is `is_recurring = TRUE` **and** carries the `habits` label; the checklist steps under a habit are undated, non-recurring subtasks carrying `sub-habits`. See Tips.

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
| J | `due_date` | YYYY-MM-DD | `2026-05-23` | The occurrence that was completed, for streak tracking. For recurring rows this comes from the event's `completed_due_date`: its `due_date` has already advanced to the NEXT occurrence by the time the event is written, so reading that instead dates every habit completion a day (or a workday) into the future |
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

**Note on habit steps**: `sub-habits` are deliberately undated, so they never appear here — a skipped routine costs exactly one row, for the parent habit. If steps ever start showing up, someone has given them a due date; that is the bug, not this tab.

**Strategy**: full daily replace — delete all rows where `snapshot_date = today`, then write fresh.

**Historical caveat**: before 2026-08-20 the nightly snapshot was stamped with the UTC date (one day ahead), which also inflated `days_overdue` by one. Subtract a day from both when reading old rows.

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

One row per day capturing Todoist's productivity metrics. Deduplication on `date` — if the row already exists for today, update it in place. Rows written before 2026-08-20 are keyed one day ahead (UTC date stamp at a 23:30 local trigger); shift them back a day when joining with the `Health` sheet.

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

## Tab 4: `RecurringStatus`

Daily snapshot of every **active recurring task** and its due date at 23:30 — one row per task per night, written whether or not the task was completed that day. When a task's due date advances between consecutive snapshots, it was completed (or rescheduled) on the earlier day.

This tab is the **spine of `HabitDaily`**: it is the only tab that records a habit's existence on the days nothing happened. Prefer `Completions` for counting check-offs (it is an event log and can see several completions of one task between runs); use this tab to reconstruct state.

**Strategy**: replace today's rows, then append the fresh snapshot (idempotent re-runs).

**Historical caveat**: rows written before 2026-08-20 are labeled one day ahead — the nightly 23:30 trigger is already past midnight UTC, and the old code stamped the UTC date. Read an old row labeled `D` as "state at the start of day `D`". Fixed on 2026-08-20 (`localDateString`).

| # | Column | Type | Example | Notes |
| --- | --- | --- | --- | --- |
| A | `snapshot_date` | YYYY-MM-DD | `2026-08-15` | Night the snapshot was taken |
| B | `task_id` | string | `6g25Qgf2FW7P63F5` | |
| C | `content` | string | `Drink Water - Drink water early…` | Full Todoist title |
| D | `project_name` | string | `Habits` | |
| E | `section_name` | string | `🌅 Morning Routine` | |
| F | `labels` | string | `habits,✅_streak` | Comma-separated |
| G | `priority` | integer 1–4 | `4` | |
| H | `due_date` | date/datetime | `2026-08-16T05:20:00` | Due of the NEXT pending occurrence at snapshot time |
| I | `recurrence_string` | string | `every workday at 5:20 am` | |
| J | `parent_id` | string | | Empty for top-level tasks |

**Header row:**
```
snapshot_date	task_id	content	project_name	section_name	labels	priority	due_date	recurrence_string	parent_id
```

---

## Tab 5: `HabitDaily`

The dense **habit × day grid** behind the Looker habit tracker: one row per tracked habit per calendar day, **including the days it was skipped**. `Completions` alone cannot power that chart — it is an event log, so a missed day simply has no row, and Looker Studio has no cross join or calendar generator to invent one.

Fully **derived, sheet-to-sheet** — the nightly path makes no API calls; only the one-time `synthesizeHabitDailyHistory()` touches the API (the live habit list, for `added_at`). `RecurringStatus` is the spine (did the habit exist that day — its due date is never used for status, since the nightly reschedule trigger moves it before the snapshot); `Completions` is the truth (was it checked off), keyed on the **local day of `completed_at`** — never on `Completions.due_date`, whose pre-2026-08-10 rows carry next-occurrence semantics. Rebuilding at any time converges on the same answer.

**Strategy**: windowed replace. The nightly `syncHabitDaily()` (last step of `syncTodoist()`, because its sources must be written first) rebuilds the trailing 7 days; `backfillHabitDaily()` rebuilds 400. An **empty tab auto-widens to the full 400-day span**, so a fresh deploy, a layout-change clear, or a manual wipe refills itself on the next nightly run. A header that does not match the current layout causes the tab to be **cleared and rebuilt**, never overwritten in place.

**Synthetic history**: rows dated before the spine's first day (2026-08-10) are written by `synthesizeHabitDailyHistory()` — reconstructed from `Completions` rather than observed. A **blank `due_date` (col K)** is the marker: no snapshot existed. Each habit's synthetic window starts at max(its Todoist `added_at`, its first captured completion) — a habit never captured before the spine began is skipped rather than painted "missed" — and its section/labels/priority/recurrence are the habit's *current* values. Safe to re-run; rebuilds never touch the block.

**Weekend policy**: Saturdays and Sundays are rest days **across all history** — an uncompleted weekend day reads `not_due`, never `missed`; a weekend check-off still counts as `done` (with `due = 1`).

**The day in progress**: today's rows read `pending`, not `missed` — the day is not over, so nothing has been skipped yet. They carry `due = 1`, `completed = 0`, and settle into `done` or `missed` on the next nightly rebuild (its 7-day window covers them). Days that have not arrived read `not_due` with `due = 0`.

**Recurrence migration (2026-08-20)**: every habit in the Habits project switched from `every day` to `every workday`, and the two Daily Reminders tasks gained workday recurrence (they enter the spine — and this grid — only from that date). Spine rows written before the migration still carry the old `every day` strings; the weekend policy deliberately overrides them, on the grounds that weekends were never part of the contract.

| # | Column | Type | Example | Notes |
| --- | --- | --- | --- | --- |
| A | `date` | YYYY-MM-DD | `2026-08-15` | Grid day |
| B | `task_id` | string | `6g25Qgf2FW7P63F5` | Stable across occurrences — the pivot key |
| C | `habit` | string | `Drink Water` | Short name: the title up to the first `" - "` |
| D | `habit_full` | string | `Drink Water - Drink water early…` | Untrimmed Todoist title |
| E | `section_name` | string | `🌅 Morning Routine` | Routine the habit belongs to |
| F | `labels` | string | `habits,health` | From the spine |
| G | `status` | enum | `done` | `done` (checked off) / `pending` (owed, today, still open) / `missed` (owed, day over, nothing recorded) / `not_due` (weekend, or a day that has not arrived) |
| H | `completed` | 0/1 | `1` | The metric for pivots and heatmaps |
| I | `due` | 0/1 | `1` | Owed that day — 1 for everything except `not_due`: any weekday the habit existed (workday contract), plus any day it was completed |
| J | `completed_at` | HH:mm | `05:22` | Local clock time of the check-off; empty unless done |
| K | `due_date` | date | `2026-08-15` | The habit's due date in that night's snapshot — shows drift |
| L | `priority` | integer 1–4 | `1` | From the spine |
| M | `recurrence_string` | string | `every workday at 5:20 am` | The rule as of that night |
| N | `sync_date` | YYYY-MM-DD | `2026-08-20` | When this row was last rebuilt |

**Header row:**
```
date	task_id	habit	habit_full	section_name	labels	status	completed	due	completed_at	due_date	priority	recurrence_string	sync_date
```

**Looker tip**: pivot table with rows = `habit`, columns = `date` (the real date, so the columns stay in calendar order and each cell is one day), metric = `MAX(completed)` — or filter `status = "missed"` for the "days I skipped" table. For a red/green/neutral grid add one calculated field, `CASE WHEN status = "done" THEN 1 WHEN status = "missed" THEN -1 ELSE 0 END`, which scores `pending` and `not_due` as a neutral 0. Set the chart's date range to **This week (starts Monday)**: with a weekday-name column dimension and a range spanning several weeks, one good Tuesday paints every Tuesday. No blends; that is the point of this tab.

---

## Script Properties required

Set these in the Apps Script project (**Project Settings → Script Properties**):

| Key | Value |
|---|---|
| `TODOIST_TOKEN` | Bearer token from [todoist.com/app/settings/integrations/developer](https://todoist.com/app/settings/integrations/developer) |
| `TODOIST_SPREADSHEET_ID` | ID from the Google Sheets URL: `docs.google.com/spreadsheets/d/<ID>/edit` |

---

## Tips

- **Habit count:** filter `Completions` to `is_recurring = TRUE` **and** `labels` containing the `habits` token. The label is what makes it a habit; recurrence alone is not enough, since any recurring task qualifies. Match the token exactly when filtering: `sub-habits` contains `habits` as a substring, so a naive "contains" test would sweep steps back in
- The taxonomy is applied at capture time, not derived in code: `habits` marks the tracked unit, `sub-habits` marks a step inside one. A new recurring task with neither label simply does not count until tagged — a visible undercount, rather than the invisible inflation an exclusion list would produce
- **Adding a step to a habit**: give it the `sub-habits` label and leave it **undated and non-recurring**. Todoist unchecks a recurring parent's subtasks when the parent recurs (the `sub_tasks_reset` field on the completion event counts them), so a step resets daily on its own. Giving a step its own recurrence is the tempting mistake: it does not improve the reset, and it turns every step into a recurring completion that inflates the habit count, a daily row in `RecurringStatus`, and an `Overdue` row whenever the routine slips. Never copy the parent's `habits` or `✅_streak`/`❌_streak` labels onto a step
- **What a step's completion looks like:** a step checked off is a one-off completion (`is_recurring = FALSE`) until the parent recurs and unchecks it. Whether that row survives the reset is unverified — an uncomplete may retract it from the completed-tasks endpoint. Do not build step-level streaks on this tab without checking first
- Filter `section_name = "In Review"` to track story/PR completions separately from task completions
- Use `complexity` to aggregate story points completed per sprint/period — join with time data for velocity tracking
- Join `KarmaStats` with the `Health` sheet on `date` to correlate productivity with sleep/HRV
- The `Overdue` tab is useful as a bar chart over time: aggregate `days_overdue` per week to spot periods of backlog accumulation
- **Parent task self-blend:** join `Completions.parent_id ↔ Completions.task_id` (alias the right side as `parent`) to attach the parent's title, project, or labels to every subtask completion. Works the same on `Overdue.parent_id`
- **Time per parent task:** chain blends — `quantified-self-everhour!TimeEntries.todoist_task_id ↔ Completions.task_id`, then `Completions.parent_id ↔ Completions.task_id` — to sum Everhour minutes per parent task without touching the Everhour script
