# Tab: `BillCycle`

One row per bill per **cycle** — the answer to *"did September's electricity cycle actually
get closed, and how long did it sit?"*

> **Read this first.** Todoist records when you **ticked the box**, never when money moved.
> Every column here measures *administrative* timeliness, not payment timeliness. A bill paid
> on time and ticked three days later reads `closed_late` — correctly, because the **cycle**
> closed late even though the payment did not.

| | |
| --- | --- |
| **Sheet · tab** | `quantified-self-todoist` · `BillCycle` |
| **Written by** | `syncBillCycle()` in [`../todoist-bill-cycle.gs`](../todoist-bill-cycle.gs) |
| **Strategy** | Full rebuild every run from `Completions` + the live task list — idempotent and self-healing |
| **Dedup key** | `task_id\|cycle_due_date` |

---

## What it is

A bill is **any task whose area is `bills-taxes`**. There is no separate bill label — the
area label already says it. See [`../area-contract.md`](../area-contract.md#what-makes-a-bill).

| Shape | Rows produced |
| --- | --- |
| Recurring | One per closed cycle, plus one for the cycle currently open |
| One-off | Exactly one |

The one-off case is load-bearing. `Pay predial` is non-recurring and was 31 days overdue on
2026-09-08; a recurring-only rule would have hidden it completely.

**Grain is the cycle, not the day.** `HabitDaily`'s daily rule would score a monthly bill
`missed` 30 days out of 31.

---

## Columns

| # | Column | Type | Example | Notes |
|---|---|---|---|---|
| A | `bill` | string | `Pay electricity bill` | Current name from the live task; falls back to the name captured on the completion |
| B | `task_id` | string | `6g26q75WHhcx3vwq` | Todoist task ID — part of the dedup key |
| C | `area` | string | `bills-taxes` | Constant by construction; present so the tab blends with the others |
| D | `project_name` | string | `Bills` | |
| E | `cycle` | YYYY-MM | `2026-08` | Derived from `cycle_due_date`, for month-over-month grouping |
| F | `cycle_due_date` | YYYY-MM-DD | `2026-08-27` | The occurrence this row is about. From `Completions.due_date` for closed cycles, the live due date for the open one |
| G | `closed_at` | YYYY-MM-DD | `2026-09-07` | **Local** day it was checked off; blank while open |
| H | `days_to_close` | integer | `11` | Due → close lag. Negative = closed early. Measured against `closed_at`, or against **today** while the cycle is still open |
| I | `status` | string | `closed_late` | `closed` · `closed_late` · `open` · `overdue` |
| J | `was_overdue` | boolean | `TRUE` | Todoist's own flag. **Blank = unknown, not on-time** |
| K | `is_recurring` | boolean | `TRUE` | |
| L | `on_time_close_streak` | integer | `3` | Consecutive cycles **closed by their due date**. `closed_late` resets it; an open cycle carries it |

`open` and `overdue` describe the **live state** of an unticked cycle — whether the task is
past its due date right now. They make no claim about payment either.

---

## Behaviour and edge cases

| Case | Behaviour | Why it matters |
| --- | --- | --- |
| **`status` vs `days_to_close` disagree** | `status` prefers `was_overdue`, which is **timestamp**-precise; `days_to_close` is **day**-precise | A task due 02:00 and ticked at 09:00 the *same day* is `was_overdue = TRUE` but zero days late. The flag wins, so the tab agrees with what Todoist itself shows |
| **`was_overdue` is blank** | Falls through to comparing `cycle_due_date` with `closed_at` | Only recurring activity events carry the flag. Blank must never default to `closed` |
| **A cycle that was never closed** | **Invisible** | No completion event exists, so there is nothing to key a row on. A documented **undercount** — the house rule is to undercount rather than fabricate. Reconstructing it means walking the recurrence between known cycles |
| **Same cycle completed twice** | The **earliest** close wins | Un-completing and re-completing should not relabel a cycle that already closed on time |
| **Completion with no `due_date`** | Skipped, and counted in the log | There is no occurrence to attribute it to. Guessing would invent a cycle |
| **Undated bill** | No open row | An undated task has no cycle to score |
| **Open cycle already closed** | The closed row wins | The live task's due date can briefly still name an occurrence that was just completed |

### `was_overdue` is not independent evidence

An earlier design claimed `completed_at` was worthless for on-time measurement and Todoist's
`was_overdue` was "the honest signal". **That was wrong**, and it is recorded here so it is not
re-derived: `was_overdue` *is* `completed_at` compared against the due date, computed by
Todoist at full timestamp precision. It is the same measurement, better resolved — not a
second source. Nothing in the Todoist payload knows anything about payments.

This is why the columns are named for closure rather than payment. Backfilling `was_overdue`
onto historical rows changes almost nothing: verified live on 2026-09-08, all five
`PAY THE MORTGAGE` cycles already carry `wasOverdue: true`, matching what the date fallback
computed.

### A due *time* can make on-time closure impossible

`PAY THE MORTGAGE` is due `every 2nd at 2:00 am`. Todoist marks it overdue from 02:00 that
day, so **every waking-hour check-off is late by construction** — which is why all five of its
cycles read `closed_late` at 1, 1, 2, 5 and 28 days.

Before concluding a bill is chronically late, check its due *time*. An all-day or evening due
time makes the metric meaningful; a small-hours one guarantees `closed_late` regardless of
behaviour. This is a Todoist-side fix, not a code one.

### Local days, not UTC

`closed_at` is the **local** day, via `localDayOf()`. This matters more here than anywhere
else: the 2026-09-08 sweep ran at 00:18 **UTC**, which is 18:18 on 2026-09-07 in the script's
timezone. Counted locally those cycles are 11 / 23 / 9 days; counted in UTC they read
12 / 24 / 10. Both describe the same event — the local figure is the correct one, and it is
the convention every other tab already uses. See
[history.md](../history.md) for the 2026-08-20 UTC→local fix that established it.

### Cycle attribution depends on the 3.6 repair

`cycle_due_date` for closed cycles comes from `Completions.due_date` (col J). Rows written
**before 2026-08-10** carry next-occurrence semantics, which for a monthly bill is wrong by a
whole cycle. Run `repairCompletionDueDates()` before trusting any cycle earlier than that
date.

---

## What is deliberately excluded

- **`deadline_date`** — a fossil. Todoist never advances a deadline when a task recurs, so
  Telcel's reads `2026-07-01` while its due date is `2026-09-29`. Any deadline-based urgency
  chart would be wrong.
- **`priority`** — every recurring bill is `p1`, so it carries no ranking signal. Order by
  days-until-due.

---

## Related

- [`../area-contract.md`](../area-contract.md) — what makes a bill, and why `was_overdue`
- [`completions.md`](completions.md) — the source of every closed cycle
- [`../../docs/plans/life-areas.md`](../../docs/plans/life-areas.md) — the report this feeds
