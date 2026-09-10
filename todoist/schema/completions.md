# Tab: `Completions`

One row per completed task — the event log, and the durable record of what was actually
done.

| | |
| --- | --- |
| **Sheet · tab** | `quantified-self-todoist` · `Completions` |
| **Written by** | `syncCompletions()` in [`../todoist-sync-completions.gs`](../todoist-sync-completions.gs) |
| **Strategy** | Incremental append — only completions since the last sync cursor are fetched. `backfillCompletions()` extends history backwards in ≤90-day windows; `backfillCompletionAreas()` fills cols O–P on pre-existing rows |
| **Dedup key** | `task_id\|completed_at` for sources 1–2; an entered-since-last-run snapshot diff for source 3 |

---

## What it is

One row per completed task, both one-off and recurring. The `is_recurring` flag
distinguishes recurring work from one-off work. A tracked habit is `is_recurring = TRUE`
**and** carries the `habits` label; the checklist steps under a habit are undated,
non-recurring subtasks carrying `sub-habits`. See
[habits-contract.md](../habits-contract.md).

This is the **durable completion store**. The activity API only refills ~90 days, so
clearing this tab permanently loses older done-ness.

---

## Event sources

Captures completions from three sources:

1. **One-off completions** — `/tasks/completed/by_completion_date`, which returns full task
   objects (labels, project, section, due, duration, parent). Recurring tasks never appear
   here.
2. **Recurring check-offs** — activity log (`/activities`, `event_type=completed`) filtered
   to `is_recurring`; these carry their labels in `extra_data`.
3. **Tasks currently in an "In Review" section** of a target project (currently
   just `Work`) — treated as PR/story ready state. See [In Review](#in-review) below.

Sources 1 and 2 are **disjoint by construction** (a task is either recurring or not), so
labels — and therefore `complexity`, a numeric-only label — populate for both task types
without a fragile cross-endpoint `task_id` join.

---

## Columns

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
| O | `area` | string | `bills-taxes` | Life area: `work`, `bills-taxes`, `errands`, `habits`, or `uncategorized`. Resolved by `areaOf()` in [`../todoist-areas.gs`](../todoist-areas.gs) |
| P | `area_source` | string | `parent` | How col O was decided: `label` (declared on the task) · `project` (an explicit override — Week/Habits/Inbox) · `parent` (derived from the project tree) · `default` (nothing matched → `uncategorized`). **Filter on this before averaging** — see below |
| Q | `was_overdue` | boolean | `TRUE` | Todoist's own verdict on whether the cycle closed late, from the activity event's `extra_data.was_overdue`. **Blank means unknown, not on-time** — only recurring activity events carry it |

**Header row:**
```
completed_at	task_id	task_content	project_id	project_name	section_name	labels	priority	is_recurring	due_date	duration_minutes	sync_date	parent_id	complexity	area	area_source	was_overdue
```

Columns A–N are read **positionally** by other tabs. O–Q were appended for that reason;
never reorder or insert. `ensureCompletionsAreaColumns()` names O–Q on first run and
refuses to overwrite them if they already hold something else.

### Reading `area` honestly

`area` is **fully retroactive** — every row has carried `project_id` since the tab was
created, so history re-derives with no API call. `labels` (col G) is **frozen at capture**,
so a row from last March cannot learn about a label added today.

The practical consequence: historical rows resolve through the project tree and read
`area_source = parent`, while rows written after the area rollout mostly read `label`. Both
are correct; they are not the same claim. A chart that mixes declared and derived rows
without saying so is asserting more confidence than the data has.

`was_overdue` measures **did the cycle close late**, not **did money move late**, and it is
not independent of `completed_at` — Todoist derives it by comparing the completion moment
against the due date. It is preferred over a date comparison only because it is
timestamp-precise rather than day-precise. See
[`../area-contract.md`](../area-contract.md#scoring-a-bill-measures-closure-not-payment).

> **Historical caveat**: col J carries split semantics either side of the 2026-08-10
> `completed_due_date` fix — see [history.md](../history.md#2026-08-10--completed_due_date-fix-in-completions).

---

## Behaviour and edge cases

| Case | Behaviour | Why it matters |
| --- | --- | --- |
| Source disjointness | A recurring check-off **never** appears in `/tasks/completed/by_completion_date`; it appears only in `/activities`. | The two sources cannot overlap, which is what removes the need for a fragile cross-endpoint join. |
| `due_date` on an activity event | Already advanced to the **next** occurrence. The occurrence actually completed is `completed_due_date`. | Reading `due_date` dates every habit completion one occurrence into the future — a day for daily habits, a whole weekend for workday ones. |
| Missing fields in `extra_data` | `labels` is omitted entirely for a task that has none. Project arrives as top-level `parent_project_id`, parent as top-level `parent_item_id` — **not** inside `extra_data`. | An empty labels cell is not cosmetic: it silently zeroes the habit count. |
| Live-task enrichment | Backfills fields the event omitted, by reading the task as it exists now. | Sound **only** because recurring tasks survive completion. The same fallback on a one-off completion would read the wrong task or nothing at all. |
| Completion with no `task_id` | Dropped, not stored. | Avoids junk rows that can never be joined. |
| Empty sheet | Cursor is ignored and the full 90-day window is pulled. | Makes "clear the sheet to re-backfill" work. The window is clamped to the API's ~3-month max regardless. |
| Cursor write ordering | `setPrevInReviewIds()` and `setLastSyncTime()` run **after** the row write. | A thrown write is retried next run instead of advancing the baseline and losing rows permanently. |
| Retracted completions | Append-only, so a habit checked off and later unchecked stays recorded for that day. | `HabitDaily` rebuilds cannot converge past this — the source itself never forgets. Known and accepted. |

---

## In Review

Source 3 is a **state snapshot, not an event stream**.

The Todoist v1 activity log does **not** expose `section_id` on `item:updated` events
(verified live — `extra_data` carries only content/description deltas), so a *move* into In
Review is undetectable from the event stream. Instead the sync snapshots the current In
Review membership each run and records **only the tasks that entered since the last run**
(current − previous), with `completed_at` set to the detection time (the API gives no actual
move timestamp). The previous membership is stored in the `TODOIST_IN_REVIEW_PREV` Script
Property and updated only after the rows are written.

A task is therefore counted on the day it moves into In Review, and **again** if it later
leaves and re-enters.

| Case | Behaviour | Why it matters |
| --- | --- | --- |
| Section moves in the event stream | Invisible — `item:updated` carries only content/description deltas, never `section_id`. | This is why In Review is a snapshot diff rather than an event source. The earlier event-based approach filtered on a field that is never present and returned zero rows. |
| First run | Previous set is empty, so every task currently in In Review is backfilled with that day's date. | Delete those rows manually if only true go-forward moves are wanted. |
| Enter and leave between runs | Missed entirely. | Nightly granularity is the ceiling. |
| Leave and re-enter | Counted again. | Intentional, but a rewrite should know it is a choice. |
| `completed_at` | Set to detection time. | The API exposes no actual move timestamp. |

---

## See also

- [habits-contract.md](../habits-contract.md) — which rows count as habits, and why the
  label token must match exactly
- [history.md](../history.md) — the 2026-08-10 `due_date` seam, and the In Review first run
- [schema/habit-daily.md](habit-daily.md) — how these rows become the "truth" half of the
  habit grid
- [`../../../todoist/looker/todoist-blends.md`](../looker/todoist-blends.md) — parent
  self-blend, Everhour time-per-task chain, In Review and complexity recipes
- [architecture §3](../../docs/todoist/architecture.md#3-main-functions-per-file) — the
  functions behind the three sources
