# Todoist blends and recipes

Looker Studio recipes built on the `quantified-self-todoist` tabs. Column-level detail for
each tab is in [`../todoist/README.md`](../README.md).

The **Habits** page is a separate build with its own calculated fields and layout — see
[`habits-page.md`](habits-page.md). It uses no blends at all, which is the point of the
`HabitDaily` tab.

---

## Filters and single-source recipes

| Recipe | Source | How |
| --- | --- | --- |
| **Story / PR completions** | QS - Completions | Filter `section_name = "In Review"` to track them separately from task completions |
| **Story points per period** | QS - Completions | Aggregate `complexity` per sprint/period; join with time data for velocity tracking |
| **Backlog accumulation** | QS - Overdue | Bar chart over time — aggregate `days_overdue` per week to spot periods where work piles up |
| **Habit count** | QS - Completions | Filter `is_recurring = TRUE` **and** `labels` containing the exact `habits` token. See [the habit contract](../habits-contract.md) — a naive "contains" test sweeps in `sub-habits` |

---

## Blends

### Parent task self-blend

Join `Completions.parent_id ↔ Completions.task_id` (alias the right side as `parent`) to
attach the parent's title, project, or labels to every subtask completion.

Works the same on `Overdue.parent_id`.

### Time per parent task

**Frozen.** Everhour is retired, so this blend gains no new data after the switchover date; it
still reads the historical tab. Chain blends summed Everhour minutes per parent task:

```
quantified-self-everhour!TimeEntries.todoist_task_id ↔ Completions.task_id
Completions.parent_id                                ↔ Completions.task_id
```

### Productivity vs recovery

Join `KarmaStats` with the `Health` sheet on `date` to correlate productivity with
sleep/HRV.

> Rows written before 2026-08-20 are keyed one day ahead — shift them back a day before
> joining. See [history.md](../history.md#2026-08-20--utc--local-date-stamps).

---

## See also

- [`README.md`](README.md#blends) — the cross-source blends (`daily_wellbeing`,
  `focus_vs_time`, `habit_vs_sleep`) and the data source list
- The Everhour side of the time-per-task chain is no longer documented in this repo —
  `git show ae21f1f:sheets/schema-everhour.md` if you need those columns
