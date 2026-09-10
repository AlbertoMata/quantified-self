# Tab: `HabitDaily`

The dense **habit × day grid** behind the Looker habit tracker: one row per tracked habit
per calendar day, **including the days it was skipped**.

| | |
| --- | --- |
| **Sheet · tab** | `quantified-self-todoist` · `HabitDaily` |
| **Written by** | `syncHabitDaily()` / `backfillHabitDaily()` in [`../todoist-habit-daily.gs`](../todoist-habit-daily.gs) |
| **Strategy** | Windowed replace — 7 days nightly, 400 on backfill |
| **Dedup key** | `date\|task_id` |
| **Sources** | `RecurringStatus` (spine) + `Completions` (truth) — no API calls |

---

## What it is

`Completions` alone cannot power a habit chart — it is an event log, so a missed day simply
has no row, and Looker Studio has no cross join or calendar generator to invent one. This
tab supplies the missing rows.

Fully **derived, sheet-to-sheet**. The nightly path makes no API calls; only the one-time
`synthesizeHabitDailyHistory()` touches the API (the live habit list, for `added_at`).

- [`RecurringStatus`](recurring-status.md) is the **spine** — did the habit exist that day.
  Its due date is never used for status, since the nightly reschedule trigger moves it
  before the snapshot.
- [`Completions`](completions.md) is the **truth** — was it checked off, keyed on the
  **local day of `completed_at`**, never on `Completions.due_date`, whose pre-2026-08-10
  rows carry next-occurrence semantics.

Rebuilding at any time converges on the same answer.

---

## Scoring rules

### Strategy

Windowed replace. The nightly `syncHabitDaily()` (last step of `syncTodoist()`, because its
sources must be written first) rebuilds the trailing 7 days; `backfillHabitDaily()` rebuilds
400. An **empty tab auto-widens to the full 400-day span**, so a fresh deploy, a
layout-change clear, or a manual wipe refills itself on the next nightly run. A header that
does not match the current layout causes the tab to be **cleared and rebuilt**, never
overwritten in place.

### Weekend policy

Saturdays and Sundays are rest days **across all history** — an uncompleted weekend day
reads `not_due`, never `missed`; a weekend check-off still counts as `done` (with `due = 1`).

### The day in progress

Today's rows read `pending`, not `missed` — the day is not over, so nothing has been skipped
yet. They carry `due = 1`, `completed = 0`, and settle into `done` or `missed` on the next
nightly rebuild (its 7-day window covers them). Days that have not arrived read `not_due`
with `due = 0`.

### Freshness

Today's rows appear as soon as a sync runs, and `syncTodoistIntraday()` runs hourly between
07:00 and 23:00 (the 23:30 nightly run finalises the day). Every step is idempotent for
same-day re-runs, so the grid simply gets more accurate as the day goes on.

### Streaks (col P)

The consecutive-`done` count as of that row, per habit. `done` increments, `missed` resets
to 0, `pending` and `not_due` carry the previous value — a weekend, a day that has not
arrived, and the day still in progress never break a streak, and a weekend check-off still
increments.

Computed in the sheet because Looker Studio cannot express a running count over an ordered
dimension. A rebuild only touches a trailing window, so the thread is **seeded** from the
last row below that window; the synthetic block therefore feeds the observed one, and
`synthesizeHabitDailyHistory()` finishes by re-running the backfill so the seam is
continuous.

### Synthetic history

Rows dated before the spine's first day (2026-08-10) are reconstructed rather than observed.
A **blank `due_date` (col K)** is the marker. Full rules — the per-habit floor, what is
skipped, which values are current rather than historical — are in
[history.md](../history.md#synthetic-habitdaily-history).

---

## Columns

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
| K | `due_date` | date | `2026-08-15` | The habit's due date in that night's snapshot — shows drift. Blank marks a synthetic row |
| L | `priority` | integer 1–4 | `1` | From the spine |
| M | `recurrence_string` | string | `every workday at 5:20 am` | The rule as of that night |
| N | `sync_date` | YYYY-MM-DD | `2026-08-20` | When this row was last rebuilt |
| O | `due_time` | HH:mm | `05:20` | Time of day the habit is owed. Parsed from `recurrence_string` first — matching both spellings Todoist stores, `at 5:25 am` and `@ 5:25 am` — then falling back to the clock time on `due_date` for rules that read bare (`every workday`) on a task that is nonetheless timed. Empty only when the habit is genuinely all-day, which Looker renders as `null`. Written **zero-padded** and the column is pinned to plain text (`pinDueTimeColumnToText()`) so Sheets cannot re-parse it into a time number: the padding is what makes a lexicographic sort chronological, and without it `20:30` sorts above `5:10`. Sorts today's habits in the order they are owed |
| P | `streak` | integer | `12` | Consecutive `done` days up to and including this row (see above) |

**Header row:**
```
date	task_id	habit	habit_full	section_name	labels	status	completed	due	completed_at	due_date	priority	recurrence_string	sync_date	due_time	streak
```

> **After a layout change**: a header that does not match causes the tab to be cleared,
> which also removes the synthetic block. Re-run `synthesizeHabitDailyHistory()` once after
> the rebuild to put it back (it re-threads the observed streaks itself).

---

## Behaviour and edge cases

| Case | Behaviour | Why it matters |
| --- | --- | --- |
| Due-ness is contract-based | Every weekday a habit has a spine row is a day it was owed; `due` is 1 for anything except `not_due`. The snapshot `due_date` is never consulted for status (kept in col K as drift info). | The snapshot cannot be trusted for scheduling: completing a habit pushes its due date past the day, and rescheduling does the same — both would read "not scheduled". A weekend check-off still counts as done with `due = 1`. |
| One status rule, two writers | `habitDayStatus(date, wasCompleted, today)` decides column G for both `rebuildHabitDaily()` and `synthesizeHabitDailyHistory()`: `done` / `pending` / `missed` / `not_due`. | The synthesizer used to duplicate the derivation, so any change to the rule had to be made twice — exactly the kind of drift that produces two different definitions of "missed" in one tab. |
| Today is `pending`, not `missed` | A day still in progress reads `pending` (`due = 1`, `completed = 0`). The nightly rebuild's 7-day window re-scores it the next night, so it settles into `done`/`missed` on its own. | The 23:30 snapshot writes today's spine rows, and a manual backfill at noon writes them mid-day: scoring them `missed` sentences habits that still have hours left. Transient by design — no row stays `pending` past its own day. |
| Attribution | A completion counts on the **local day it was checked off**, from `completed_at` in the script timezone. | Deliberate: it answers "on which days did I actually do this". The tradeoff is that catching up Monday's habit on Wednesday marks Wednesday, not Monday. |
| Weekend rest days | Saturday/Sunday uncompleted reads `not_due` across **all** history; a weekend check-off still reads `done` with `due = 1` (`isRestDay()`). | Deliberate reinterpretation, not a bug: the habits ran `every day` until 2026-08-20, but the owner's contract never included weekends — charts must not penalize them. |
| 2026-08-20 recurrence migration | Pre-migration spine rows keep the old `every day` strings; the weekend rule overrides them by design. See [history.md](../history.md#2026-08-20--recurrence-migration). | Any future *synthesized* pre-Aug-10 spine must apply the same rest-day rule rather than trusting those historical strings. |
| Rescheduling cannot hide a miss | The reschedule trigger fires ~20:09 nightly — before the 23:30 snapshot — bumping every skipped habit to tomorrow. Under snapshot-based due-ness this laundered every miss into `not_due` (observed live: Aug 20 – Sep 3 2026 weekdays read 0 across the board). | Contract-based due-ness (row above) eliminated the blind spot: a bumped-but-uncompleted weekday reads `missed`. Regression-tested with a bumped fixture row. |
| Habits completed between 23:30 and midnight | Land in the following day's data. | The 7-day rebuild window exists precisely so the next run corrects them. A one-day window would lose them. |
| Streaks are seeded, not restarted | `readStreakSeeds()` reads, per habit, the streak on its last row *below* the replace boundary; the rebuild threads forward from there. | A rebuild only writes a trailing window. Threading from 0 inside it would reset every streak to at most the window's length on each nightly run — a seven-day ceiling on a hundred-day streak. |
| Synthesizer re-threads the observed block | `synthesizeHabitDailyHistory()` finishes by calling `rebuildHabitDaily(HABIT_DAILY_BACKFILL_DAYS)`. | The observed rows were threaded before any history existed, so they started at 0 on the spine's first day. The rebuild re-seeds them from the synthetic block; its clamp keeps the synthetic rows themselves untouched. |
| A layout change drops synthetic history | The header guard clears the tab, and the auto-widen rebuilds only what the spine can regenerate — which is nothing before 2026-08-10. | Re-run `synthesizeHabitDailyHistory()` once after any column change. Called out next to the column list above, because the loss is silent otherwise. |
| Intraday re-runs | The rebuild is idempotent for the same day — it replaces its own window. | This is what makes the hourly trigger safe, and what keeps the dashboard's "today" view live rather than a 23:30 snapshot. |
| Spine row labeled after today | Rendered, but always as `not_due` with `due = 0`. | A snapshot cannot observe a day that has not happened — a future label is always a stamping artifact (seen live on 2026-08-20). What mattered was never showing tomorrow's habits as pre-emptively `missed`; the status rule guarantees that, so the row itself is harmless and stays visible. |
| Ordering | Must run after both `Completions` and `RecurringStatus`. | Running earlier rebuilds today's grid from a spine that has no rows for today. |
| Missing `Completions` tab | Every habit day reads as missed. Logged, no crash. | Degrades loudly rather than silently. |
| Missing `RecurringStatus` tab | No-op with a log line, no tab created. | The spine is checked *before* the tab is created — bailing after `getOrCreateHabitDailySheet()` would leave an empty `HabitDaily` behind that nothing ever fills. |
| Habit naming | Column C stores the title up to the first `" - "`; the untrimmed title is kept in `habit_full`. | Half the habits carry a motivational tagline and half do not, so raw titles make Looker row labels a mix of phrases and sentences. Deriving the short name here avoids renaming tasks and avoids fighting the Habit Tracker app over titles. |
| Layout change | An outdated header causes the whole tab to be cleared, not overwritten. | Existing rows are positional; writing new columns over stale rows would leave silently misaligned data. The grid is derived, so a backfill rebuilds it. |
| Empty tab | The rebuild window auto-widens to `HABIT_DAILY_BACKFILL_DAYS` (400), whatever window was asked for. | Without it, the first nightly run after a layout change would clear the tab and refill only 7 days — history truncated to a week until someone noticed. It also makes a fresh deploy backfill itself. |
| Label matching | Exact token, never substring — see [habits-contract.md](../habits-contract.md). | `sub-habits` contains `habits` as a substring, so a naive "contains" test sweeps every checklist step back into the habit count. |
| Window wipe | One contiguous `clearContent()` — not `deleteRows()`, and not row-by-row. | Per-row calls turn a 400-day backfill into a timeout, and `deleteRows()` throws "you can't delete all unfrozen rows" (seen live, in Spanish) the moment the header row is frozen — which a full-window rebuild triggers every time, since all data rows are stale at once. Clearing leaves the grid rows in place; the rewrite lands on top. |
| Coexistence with the nightly sync | Rebuilds key done-ness on `completed_at` (Completions col A) and due-ness on the spine snapshot — never on Completions col J (`due_date`). | Col J carries split semantics (pre/post the Aug-10 `completed_due_date` fix), so reading it would resurrect the bug on every rebuild. The spine's due dates come from `/tasks/filter` snapshots, a pipeline that bug never touched. Completions is the durable completion store — the activity API refill caps at ~90 days, so clearing that tab permanently loses older done-ness. |
| Synthetic history floor | A habit's synthetic window starts at max(`added_at`, first captured completion); zero captures ⇒ skipped entirely. | Recurring capture only began at some point — synthesising earlier days would paint every uncaptured day `missed` (streak poison). Deliberate undercount: misses can be lost, never fabricated. Also keeps out tasks that carry `habits` today but were plain reminders then. |
| Synthetic rows vs rebuilds | `rebuildHabitDaily` clamps its replace boundary to the earliest observed spine day. | Without the clamp, a 400-day backfill would delete the synthetic block while regenerating nothing in its place — the spine has no rows there. |
| Retracted completions | `Completions` is append-only, so a habit checked off and later unchecked stays `done` for that day — see [completions.md](completions.md). | Rebuilds cannot converge past this: the source itself never forgets. Known and accepted. |

---

## Building charts on this tab

The full Looker Studio recipe — calculated fields, the week grid, the Today section, the
`due_time` sort trap — is [`../../../todoist/looker/habits-page.md`](../looker/habits-page.md).
It builds entirely on this tab; no blends, which is the point of having it.

---

## See also

- [schema/recurring-status.md](recurring-status.md) — the spine
- [schema/completions.md](completions.md) — the truth
- [habits-contract.md](../habits-contract.md) — how habits and their steps are labelled
- [history.md](../history.md) — the synthetic block, the spine start, the recurrence
  migration
- [architecture §3](../../docs/todoist/architecture.md#3-main-functions-per-file) — the
  rebuild, synthesizer and diagnostic functions
