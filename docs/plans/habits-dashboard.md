# Habits page in Looker Studio — design

**Status**: designed, not implemented (2026-09-04). Nothing in this document has been
built yet; it is the agreed plan for the Habits dashboard and the sheet changes it needs.

The goal is one Looker Studio page, **Habits**, with three sections serving two moods:
*pressure* during the day and week (what is still open, am I keeping cadence) and *pride*
over the week and month (what got done, streaks, rates). Some habits are optional — a
second cup of coffee — and must be filterable out of the numbers.

`HabitDaily` already scores every habit-day as `done` / `pending` / `missed` / `not_due`
(see [`../../sheets/todoist/schema-todoist.md`](../../sheets/todoist/schema-todoist.md)),
which is what makes a real tracker possible. Two data gaps still block it: there is no
`streak` column (Looker Studio cannot compute a running count), and no time-of-day to
order today's list by — the recurrence string carries it (`every workday at 09:10 am`) but
Looker cannot sort on that.

## Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Optional habits | Todoist label `optional`; the sheet still scores a skip as `missed` | Keeps one honest definition of "missed" in the data. Looker hides them with a `habit_type` field plus a filter control, so the same rows serve both views |
| Freshness | Hourly `syncTodoist()` between 07:00 and 23:00, nightly 23:30 kept | The Today section is useless as a 23:30 snapshot. Every sync step is already idempotent for same-day reruns (Completions cursor, Overdue/RecurringStatus replace today's rows, Karma upserts, HabitDaily rebuilds its window) |
| Streaks | Computed in the sheet, stored per row | Looker Studio has no running-total over a dimension; a `streak` column makes "current" and "best" trivial scorecards |
| Target | A Looker **parameter**, default 80% | Gauges and reference lines adjust from the report without touching data. A fixed 100% would paint the month red for a normal month |

## Part 1 — Data changes (`sheets/todoist/`)

### `todoist-habit-daily.gs` — two new columns: `due_time` (O) and `streak` (P)

- `HABIT_DAILY_HEADER` gains `due_time`, `streak` (16 columns). The layout guard in
  `getOrCreateHabitDailySheet()` clears the tab once on deploy; the empty-tab auto-widen
  rebuilds the full span on its own. **The synthetic block is lost by that clear** —
  re-run `synthesizeHabitDailyHistory()` once afterwards.
- `dueTimeOf(recurrence)` helper: `/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i` → `"HH:mm"`
  24-hour (`8:30 pm` → `20:30`, `5:50` → `05:50`), `""` when the rule has no time. Used by
  both writers.
- **Streak rule** (single function, e.g. `nextStreak(prev, status)`): `done` → prev + 1;
  `missed` → 0; `pending` / `not_due` → prev (weekends, future days and the day in progress
  carry the streak forward; a weekend check-off still counts). Rows are sorted by date,
  then threaded per `task_id`.
- **Seeding across the rebuild window** in `rebuildHabitDaily()`: before
  `replaceHabitDailyRows()`, read the existing tab and take, per `task_id`, the `streak` of
  the latest row dated `< replaceCutoff`. Rows are date-sorted, so "last occurrence wins".
  A habit with no earlier row seeds at 0. This is what makes the nightly 7-day window and
  the 400-day backfill agree.
- `synthesizeHabitDailyHistory()` computes streaks from 0 at each habit's floor, and
  **ends by calling `rebuildHabitDaily(HABIT_DAILY_BACKFILL_DAYS)`** so the observed block
  re-seeds from the last synthetic row (the backfill's clamp keeps the synthetic rows).
- Header comment: document both columns, the streak rule, the seeding, and the re-thread.

### `todoist-sync.gs` — intraday entry point

- `syncTodoistIntraday()`: returns early (with a log line) outside 07:00–23:00 script-local
  time, otherwise calls `syncTodoist()`. Installed as an **hourly** time trigger; the 23:30
  nightly trigger stays (it is the run that finalises the day). Update the trigger comment
  at the top of the file.
- No other code change: reruns are already safe. Note in the docs that
  `syncRecurringStatus`'s per-row `deleteRow` loop (today's rows) now runs ~17×/day — fine,
  but it is the frozen-header-sensitive path (it only throws when today's rows are the
  *only* data rows, i.e. never after the first day).

### Docs to update alongside

- `sheets/todoist/schema-todoist.md`: HabitDaily table → 16 columns (`due_time`, `streak`
  with the rule and the "pending carries" note); intraday schedule paragraph; "after a
  layout change, re-run `synthesizeHabitDailyHistory()`" note.
- `docs/todoist/architecture.md`: schedule (hourly + nightly), `syncTodoistIntraday` in the
  orchestrator table, `dueTimeOf`/`nextStreak` where `habitDayStatus` is listed, and §7
  rows: *streak seeding across the window*, *synthesizer re-threads streaks*, *layout
  change drops the synthetic block*, *intraday reruns*.
- `README.md`: setup step 5 gains the hourly trigger; tree gains `analytics/habits-page.md`.

## Part 2 — Looker Studio recipe (`analytics/habits-page.md`, new)

Looker has no code to commit, so the deliverable is a build recipe precise enough to follow
click-by-click. `analytics/README.md` gets the two missing data sources
(`QS - HabitDaily`, `QS - RecurringStatus`) and a link to the recipe. Set the
`QS - HabitDaily` source **data freshness to 15 minutes**.

### Calculated fields on `QS - HabitDaily`

| Field | Formula | Used by |
| --- | --- | --- |
| `status_score` | `CASE WHEN status="done" THEN 1 WHEN status="missed" THEN -1 ELSE 0 END` | week grid heatmap |
| `rate` | `SUM(completed) / SUM(due)` | every rate scorecard, gauge, bar |
| `habit_type` | `IF(CONTAINS_TEXT(labels, "optional"), "optional", "core")` | filter control + default filters |
| `pending_count` / `missed_count` / `done_count` | `SUM(IF(status="pending",1,0))` etc. | Today + week scorecards |
| `iso_weekday` | `FORMAT_DATETIME("%u-%a", date)` (Mon=1) | month heatmap columns |
| `iso_week` | `ISOWEEK(date)` | month heatmap rows |
| `target_pct` | **parameter**, number, default `0.8` | gauges, reference lines |
| `rate_vs_target` | `rate - target_pct` | conditional colouring (green ≥ 0) |

### Page layout

Three sections, each with its **own chart-level date range** — no page-wide date control,
since the sections must not share one.

**1. Today** (date range *Today*; needs the hourly sync — the day's rows exist from the
07:00 run)

- Scorecards: `done_count / SUM(due)` as "done / due", `pending_count` ("still open"),
  `rate` ("today %", coloured by `rate_vs_target`).
- Table "What's left": rows = `section_name`, `due_time`, `habit`, `status`, `streak`;
  sorted by `due_time`; conditional colour on `status` (`pending` amber, `done` green);
  optional filter on `status = pending` for the pure to-do view.

**2. This week** (date range *This week, starts Monday*; comparison = previous period)

- Pivot "Habits Weekly": rows = `habit`, columns = `date` (the real date → calendar order,
  one cell per day), metric = `MAX(status_score)`, heatmap colouring −1 red / 0 grey /
  1 green.
- Scorecards: `rate` with previous-period comparison, `missed_count`, `done_count`.
- Gauge: `rate` against `target_pct`.
- Bar: `date` × `done_count` and `SUM(due)` (stacked or side by side) — the cadence view.

**3. This month** (date range *This month*; comparison = previous period)

- Scorecards: `done_count` ("habits completed"), `rate` vs last month, `MAX(streak)`
  ("best streak"), and current streak = a table filtered to *Today* showing `habit`,
  `streak`, sorted desc (today's row carries the streak during the day).
- Bar (horizontal): `habit` × `rate`, sorted desc, coloured by `rate_vs_target`, reference
  line at `target_pct`.
- Heatmap pivot: rows = `iso_week`, columns = `iso_weekday`, metric = `rate` — the calendar.
- Line: `date` × `rate` with a reference line at `target_pct`.

### Filters (top of page, apply to all sections)

- Filter control `habit_type` (default **core**) — the optional-habits switch. Rate charts
  additionally carry a chart-level filter `habit_type = core` so optional habits never
  dilute a rate unless deliberately included via the control.
- Filter control `section_name` (Morning / Work / Evening / Daily Reminders).
- Filter control `habit` (multi-select).

## Part 3 — Todoist

Add the label `optional` to the habits that are genuinely optional (second coffee, …).
Labels flow through `RecurringStatus` col F into `HabitDaily` col F unchanged, so no sync
change is needed; synthetic rows carry the habit's *current* labels.

## Files

- Modify: `sheets/todoist/todoist-habit-daily.gs`, `sheets/todoist/todoist-sync.gs`,
  `sheets/todoist/schema-todoist.md`, `docs/todoist/architecture.md`, `analytics/README.md`,
  `README.md`
- Create: `analytics/habits-page.md`
- Test harness (scratchpad, not in the repo): `hd-harness.js`

Reuse: `habitDayStatus`, `isRestDay`, `dateKey`, `localDateString`, `addDays`,
`replaceHabitDailyRows`, the layout guard and the empty-tab auto-widen — all already in
place.

## Verification

1. `node --check` on the `.gs` copies; run the harness. New assertions: `dueTimeOf` on
   `"every workday at 8:30 pm"` / `"at 09:10 am"` / `"every day at 5:50"` / no time;
   streak threading (done, done, weekend `not_due`, done → 3; `missed` resets; `pending`
   carries); **seeding**: a 7-day `syncHabitDaily()` on a populated tab continues the
   streak from the row above the window; a synthesizer re-run leaves the observed block
   continuous with the synthetic one; `syncTodoistIntraday()` is a no-op at 02:00 and runs
   at 09:00 (stub `NOW`).
2. Docs: every new symbol named in the docs exists (`grep`); spaced table pipes (MD060).
3. After deploy: run `backfillHabitDaily()` (the layout clear and auto-widen happen on
   their own), then `synthesizeHabitDailyHistory()`; check `diagnoseHabitDailySources()`
   and that `streak` is continuous across 2026-08-10. Install the hourly trigger on
   `syncTodoistIntraday`; confirm a mid-morning run leaves today's rows `pending`/`done`.
4. Looker: add the sources and fields from the recipe, build the page, and confirm the week
   pivot shows Mon→Fri in calendar order with −1 only on days that have finished.
