# Tab: `AreaDaily`

One row per **area per day** — the dense grid behind the "how am I doing in each area of my
life?" page.

| | |
| --- | --- |
| **Sheet · tab** | `quantified-self-todoist` · `AreaDaily` |
| **Written by** | `syncAreaDaily()` in [`../todoist-area-daily.gs`](../legacy-implementation/todoist-area-daily.gs) |
| **Strategy** | Replace today's rows, then append (the `Overdue` idiom) |
| **Backfill** | `backfillAreaDaily()` — fills `completed` for past days only |

---

## What it is

Five rows every day — one per area, plus `uncategorized` — written whether or not anything
happened. Looker has no cross join and no calendar generator, so a quiet day has no row to
render unless this tab supplies one.

**Section-agnostic by construction.** Board vocabularies differ across projects
(`Study/Reading` has Backlog / In Progress / **Quiz** / Done, and `Bills`, `Finance`, `SAT`,
`Challenger` and `Purchases` have no sections at all), so an area-level rollup cannot share one column vocabulary. This tab counts tasks,
never columns. Card-level detail lives in [`task-daily.md`](task-daily.md).

---

## Columns

| # | Column | Type | Example | Notes |
|---|---|---|---|---|
| A | `snapshot_date` | YYYY-MM-DD | `2026-09-08` | Local day |
| B | `area` | string | `bills-taxes` | One of the four, or `uncategorized` |
| C | `open` | integer | `15` | Open tasks in the area. **Snapshot only** |
| D | `overdue` | integer | `3` | Open with a due date before today. **Snapshot only** |
| E | `in_week` | integer | `5` | Open tasks that also sit in `Week`. **Snapshot only** |
| F | `p1_open` | integer | `9` | Open tasks at API priority 4 (= `p1`, highest). **Snapshot only** |
| G | `completed` | integer | `4` | Completions attributed to this day. **Derived, backfillable** |
| H | `counts_observed` | boolean | `TRUE` | `TRUE` when C–F are real observations; `FALSE` on a backfilled row |

---

## The one thing to understand before charting this

**Two kinds of column live here, and they do not have the same reach.**

`completed` derives from `Completions`, which reaches back to the beginning of the sheet, so
it is fully backfillable. `open`, `overdue`, `in_week` and `p1_open` are snapshots of a
moment — Todoist keeps no history of what was open on a past day, so they only accrue
forward from the day this tab starts running.

A backfilled row leaves C–F **blank, not zero**. A zero would assert "nothing was open that
day", which is a claim this tab is in no position to make. **Filter on
`counts_observed = TRUE` before plotting any of C–F**, or the series will appear to start at
nothing and climb.

`uncategorized` is a metric in its own right: a rising line there means the taxonomy is
drifting and something needs an `area-*` label or a home under a parent project.

---

## Behaviour and edge cases

| Case | Behaviour | Why it matters |
| --- | --- | --- |
| Hourly re-run | Today's rows are cleared and rewritten | The intraday trigger must refresh the day, not stack a second set on top |
| An area with nothing in it | Still gets a row, with zeros | That is the entire point of a dense grid |
| A new area appears | Picked up automatically | The row set comes from `AREA_ORDER`, so adding an area is one edit in [`../todoist-areas.gs`](../legacy-implementation/todoist-areas.gs) |
| Layout change | The tab is **archived**, not cleared | C–F are observations that cannot be re-observed. Only `completed` could be rebuilt |
| Completion attribution | The **local** day of `completed_at` | Matches `HabitDaily`, so the two tabs agree on which day a completion belongs to |

---

## Related

- [`../area-contract.md`](../area-contract.md) — how a task gets its area
- [`task-daily.md`](task-daily.md) — the card-level companion
- [`completions.md`](completions.md) — the source of `completed`
