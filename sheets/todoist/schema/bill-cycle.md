# Tab: `BillCycle`

One row per bill per **cycle** — the answer to *"did September's electricity actually get
paid, and was it late?"*

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
| H | `days_late` | integer | `11` | Negative = closed early. Measured against `closed_at`, or against **today** while the cycle is still open |
| I | `status` | string | `late` | `paid` · `late` · `open` · `overdue` |
| J | `was_overdue` | boolean | `TRUE` | Todoist's own verdict. **Blank = unknown, not on-time** |
| K | `is_recurring` | boolean | `TRUE` | |
| L | `on_time_streak` | integer | `3` | Consecutive cycles closed on time. `late` resets it; an open cycle carries it |

---

## Behaviour and edge cases

| Case | Behaviour | Why it matters |
| --- | --- | --- |
| **`status` vs `days_late` disagree** | `status` comes from Todoist's `was_overdue`; `days_late` from the dates | Disagreement means the check-off was **retroactive** — a batch sweep closing a cycle days after the money actually moved. That is information, not a defect |
| **`was_overdue` is blank** | Falls through to comparing `cycle_due_date` with `closed_at` | Only recurring activity events carry the flag. Blank must never default to `paid` |
| **A cycle that was never closed** | **Invisible** | No completion event exists, so there is nothing to key a row on. A documented **undercount** — the house rule is to undercount rather than fabricate. Reconstructing it means walking the recurrence between known cycles |
| **Same cycle completed twice** | The **earliest** close wins | Un-completing and re-completing should not relabel a cycle that already closed on time |
| **Completion with no `due_date`** | Skipped, and counted in the log | There is no occurrence to attribute it to. Guessing would invent a cycle |
| **Undated bill** | No open row | An undated task has no cycle to score |
| **Open cycle already closed** | The closed row wins | The live task's due date can briefly still name an occurrence that was just completed |

### Local days, not UTC

`closed_at` is the **local** day, via `localDayOf()`. This matters more here than anywhere
else: the 2026-09-08 sweep ran at 00:18 **UTC**, which is 18:18 on 2026-09-07 in the script's
timezone. Counted locally those cycles are 11 / 23 / 9 days late; counted in UTC they read
12 / 23+1 / 10. Both describe the same event — the local figure is the correct one, and it is
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
- [`../../docs/plans/life-areas.md`](../../../docs/plans/life-areas.md) — the report this feeds
