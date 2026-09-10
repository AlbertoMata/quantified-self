# Tab: `Overdue`

Daily snapshot of tasks that were due but not completed.

| | |
| --- | --- |
| **Sheet · tab** | `quantified-self-todoist` · `Overdue` |
| **Written by** | `syncOverdue()` in [`../todoist-sync.gs`](../todoist-sync.gs), from `/tasks/filter?query=overdue` |
| **Strategy** | Full daily replace — delete all rows where `snapshot_date = today`, then write fresh |
| **Dedup key** | `snapshot_date` |

---

## What it is

The sync script **replaces** today's rows on each run rather than appending — overdue is a
**state, not an event log**. A task that stays overdue for a week produces seven rows, one
per night, which is what makes the backlog visible over time.

Because it is replaced rather than appended, the tab is safe to re-run intraday.

---

## Columns

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

> **Historical caveat**: before 2026-08-20 the nightly snapshot was stamped with the UTC
> date (one day ahead), which also inflated `days_overdue` by one — see
> [history.md](../history.md#2026-08-20--utc--local-date-stamps).

---

## Behaviour and edge cases

| Case | Behaviour | Why it matters |
| --- | --- | --- |
| Date cells read back from Sheets | Returned as `Date` objects once the column is date-formatted, so a raw `===` against `"YYYY-MM-DD"` never matches. | Without the `dateKey()` normaliser the daily replace silently appends on top of the old snapshot instead of replacing it — duplicates, not an error. |
| Sub-habits | Undated by design, so they never reach this tab. | A skipped routine costs exactly one row, for the parent habit. One appearing here means it was given a due date. That is the bug, not the tab. |

---

## See also

- [habits-contract.md](../habits-contract.md) — why habit steps stay undated
- [history.md](../history.md) — the 2026-08-20 date-stamp fix
- [`../../../todoist/looker/todoist-blends.md`](../looker/todoist-blends.md) — the
  backlog-over-time bar chart
