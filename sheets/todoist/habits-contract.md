# The habit contract

How a habit is **authored in Todoist** so the sync can see it. This is a capture-time
taxonomy, not something derived in code: a new recurring task with neither label simply does
not count until it is tagged — a visible undercount, rather than the invisible inflation an
exclusion list would produce.

How a habit is then **scored** — `done` / `pending` / `missed` / `not_due`, weekends,
streaks — is [schema/habit-daily.md](schema/habit-daily.md).

---

## What makes a habit

| Thing | Definition |
| --- | --- |
| **Habit** | A recurring task carrying the `habits` label. The tracked unit |
| **Step** | An undated, non-recurring subtask of a habit, carrying the `sub-habits` label |

Recurrence alone is not enough — any recurring task qualifies for that. The **label** is
what makes it a habit.

**Counting habits** in `Completions`: filter to `is_recurring = TRUE` **and** `labels`
containing the `habits` token.

**Match the token exactly.** `sub-habits` contains `habits` as a substring, so a naive
"contains" test sweeps every checklist step back into the habit count. The scripts match on
exact tokens for this reason.

---

## Adding a step to a habit

Give it the `sub-habits` label and leave it **undated and non-recurring**.

Todoist unchecks a recurring parent's subtasks when the parent recurs (the `sub_tasks_reset`
field on the completion event counts them), so a step resets daily on its own.

**Giving a step its own recurrence is the tempting mistake.** It does not improve the reset,
and it turns every step into:

- a recurring completion that inflates the habit count,
- a daily row in `RecurringStatus`,
- an `Overdue` row whenever the routine slips.

**Never copy the parent's `habits` or `✅_streak` / `❌_streak` labels onto a step.**

---

## What a step's completion looks like

A step checked off is a **one-off** completion (`is_recurring = FALSE`) until the parent
recurs and unchecks it.

Whether that row survives the reset is **unverified** — an uncomplete may retract it from
the completed-tasks endpoint. Do not build step-level streaks on `Completions` without
checking first.

---

## Why steps stay undated

`sub-habits` are deliberately undated, so they never reach the `Overdue` or
`RecurringStatus` tabs. A skipped routine therefore costs exactly one row, for the parent
habit.

If steps ever start showing up in either tab, someone has given them a due date. **That is
the bug, not the tab.**

---

## Rescheduling

`todoist-reschedule-habits.gs` bumps skipped habits forward, and moves a **habit and its
steps as one unit** — the parent decides, the steps follow. Judged individually they go
stale on different clocks and the steps land a day behind.

That module is manual and is the only path in this project that writes back to Todoist. Its
behaviour is documented in
[architecture §7](../../docs/todoist/architecture.md#reschedule-habits).

A bump cannot hide a miss: `HabitDaily` scores due-ness from the contract, not from the
snapshot due date, so a bumped-but-uncompleted weekday still reads `missed`.
