# Tab: `RecurringStatus`

Daily snapshot of every active recurring task and its due date — the **spine** of
`HabitDaily`.

| | |
| --- | --- |
| **Sheet · tab** | `quantified-self-todoist` · `RecurringStatus` |
| **Written by** | `syncRecurringStatus()` in [`../todoist-sync.gs`](../legacy-implementation/todoist-sync.gs), from `/tasks/filter?query=recurring` |
| **Strategy** | Replace today's rows, then append the fresh snapshot (idempotent re-runs) |
| **Dedup key** | `snapshot_date\|task_id` |

---

## What it is

One row per active recurring task per night at 23:30, written **whether or not the task was
completed that day**. When a task's due date advances between consecutive snapshots, it was
completed (or rescheduled) on the earlier day.

This tab is the **spine of [`HabitDaily`](habit-daily.md)**: it is the only tab that records
a habit's existence on the days nothing happened. Prefer `Completions` for counting
check-offs — it is an event log and can see several completions of one task between runs;
use this tab to reconstruct state.

The spine starts on 2026-08-10. Nothing before that day was ever observed, which is why
`HabitDaily`'s earlier rows are synthetic.

---

## Columns

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

> **Historical caveats**: rows written before 2026-08-20 are labeled one day ahead — read an
> old row labeled `D` as "state at the start of day `D`". Rows before the same date still
> carry pre-migration `every day` recurrence strings. Both in
> [history.md](../history.md).

---

## Behaviour and edge cases

| Case | Behaviour | Why it matters |
| --- | --- | --- |
| Date cells read back from Sheets | Returned as `Date` objects once the column is date-formatted, so a raw `===` against `"YYYY-MM-DD"` never matches. | Without the `dateKey()` normaliser the daily replace silently appends on top of the old snapshot instead of replacing it — duplicates, not an error. |
| Two completions between runs | Cannot see them — it records state, not events. | Use `Completions` for counting; use this tab to reconstruct state on days the event source came back empty. |
| Sub-habits | Undated by design, so they never reach this tab. | One appearing here means it was given a due date. That is the bug, not the tab. |
| Intraday re-runs | The per-row `deleteRow` loop for today's rows now runs ~17×/day. | It is the frozen-header-sensitive path, but it only throws when today's rows are the *only* data rows — i.e. never after the first day. |
| `due_date` after a reschedule | Moves before the nightly snapshot: the reschedule trigger fires ~20:09, bumping every skipped habit to tomorrow. | This is why `HabitDaily` **never** reads col H for due-ness — it would launder every miss into `not_due`. Kept in the grid's col K as drift information only. |

---

## See also

- [schema/habit-daily.md](habit-daily.md) — what the spine is used for, and why its
  `due_date` is deliberately ignored
- [habits-contract.md](../habits-contract.md) — which of these rows count as habits
- [history.md](../history.md) — the spine's start date, the date-stamp fix, and the
  recurrence migration
