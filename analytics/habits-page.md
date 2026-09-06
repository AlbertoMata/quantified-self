# Habits page — Looker Studio build recipe

A single Looker Studio page, **Habits**, built entirely on `HabitDaily`
(see [`../sheets/todoist/schema-todoist.md`](../sheets/todoist/schema-todoist.md#tab-5-habitdaily)).
No code ships for this part — Looker has nothing to commit — so this doc is
the build recipe, precise enough to follow click-by-click. Rebuild from here
if the page is ever lost or needs to be recreated from scratch.

Background and the decisions behind this layout live in
[`../docs/plans/habits-dashboard.md`](../docs/plans/habits-dashboard.md).

---

## 1. Data sources

Add both in **Looker Studio → Add data → Google Sheets**, same spreadsheet
as the other `quantified-self-todoist` sources in
[`README.md`](README.md#data-sources):

| Data source name | Sheet | Tab |
| --- | --- | --- |
| QS - HabitDaily | quantified-self-todoist | HabitDaily |
| QS - RecurringStatus | quantified-self-todoist | RecurringStatus |

`QS - RecurringStatus` is the spine of the habit list — it carries every
active habit regardless of that day's status — and is added alongside
`QS - HabitDaily` per the tab's own doc; the page below builds entirely on
`QS - HabitDaily`, whose `status` column already folds in everything
`RecurringStatus` tracks.

**Freshness**: open `QS - HabitDaily` → data source settings → **Data
freshness → 15 minutes**. The Today section reads this source live during
the day (hourly sync writes new rows at :00; 15-minute freshness keeps the
page within one refresh of that).

---

## 2. Calculated fields (on `QS - HabitDaily`)

Add each in the data source editor (**Add a field**) before building any
chart:

| Field | Formula | Used by |
| --- | --- | --- |
| `status_score` | `CASE WHEN status="done" THEN 1 WHEN status="missed" THEN -1 ELSE 0 END` | week grid heatmap |
| `rate` | `SUM(completed) / SUM(due)` | every rate scorecard, gauge, bar |
| `habit_type` | `IF(CONTAINS_TEXT(labels, "optional"), "optional", "core")` | filter control + default filters |
| `pending_count` | `SUM(CASE WHEN status="pending" THEN 1 ELSE 0 END)` | Today scorecard |
| `missed_count` | `SUM(CASE WHEN status="missed" THEN 1 ELSE 0 END)` | This week scorecard |
| `done_count` | `SUM(CASE WHEN status="done" THEN 1 ELSE 0 END)` | Today + This week + This month scorecards |
| `iso_weekday` | `FORMAT_DATETIME("%u-%a", date)` | month heatmap columns (Mon=1) |
| `iso_week` | `ISOWEEK(date)` | month heatmap rows |
| `target_pct` | parameter, type **Number**, default `0.8` | gauges, reference lines |
| `rate_vs_target` | `rate - target_pct` | conditional colouring (green when ≥ 0) |

**Adding the `target_pct` parameter**: data source editor → **Add a
parameter** → name `target_pct` → type Number → default value `0.8`. It
then appears both as a field (for `rate_vs_target`) and, on any chart, under
**Style → apply a parameter** for a reference line.

---

## 3. Page layout

Three sections stacked on one page. **Each section gets its own
chart-level date range** — set via each chart's **Data → Date range
dimension → default date range**, never a page-level date range control,
since the three sections must not share one.

### Section 1 — Today

Chart date range: **Today**. (Needs the hourly `syncTodoistIntraday()` run
— the day's rows exist from 07:00 onward; before that the section is
empty.)

- **Scorecard** "done / due": metric `done_count`, comparison metric
  `SUM(due)`.
- **Scorecard** "still open": metric `pending_count`.
- **Scorecard** "today %": metric `rate`, conditional formatting on
  `rate_vs_target` (green ≥ 0, red < 0).
- **Table** "What's left": dimensions `section_name`, `due_time`, `habit`,
  `status`, `streak`; sort by `due_time` ascending; conditional
  formatting on `status` (`pending` amber, `done` green, `missed` red).
  Add an optional chart-level filter `status = pending` for a pure to-do
  view (duplicate the table without the filter if both views are wanted).

### Section 2 — This week

Chart date range: **This week (starts Monday)**; comparison = **previous
period** on every chart that supports it.

- **Pivot table** "Habits Weekly": row dimension `habit`, column
  dimension `date` (the real date, not a weekday name — keeps columns in
  calendar order, one column per day); metric `MAX(status_score)`; heatmap
  colouring on the metric, −1 red / 0 grey / 1 green.
- **Scorecard**: metric `rate`, comparison = previous period.
- **Scorecard**: metric `missed_count`.
- **Scorecard**: metric `done_count`.
- **Gauge**: metric `rate`, target from the `target_pct` parameter.
- **Bar chart** (cadence): dimension `date`, metrics `done_count` and
  `SUM(due)`, stacked or side-by-side bars.

### Section 3 — This month

Chart date range: **This month**; comparison = **previous period** where
supported.

- **Scorecard** "habits completed": metric `done_count`.
- **Scorecard**: metric `rate`, comparison = previous month.
- **Scorecard** "best streak": metric `MAX(streak)`.
- **Table** "current streak": same source, chart-level date range override
  to **Today** (today's row carries the current streak through the day);
  dimensions `habit`, `streak`; sort `streak` descending.
- **Bar chart** (horizontal): dimension `habit`, metric `rate`, sort
  descending, colour by `rate_vs_target`, reference line at `target_pct`.
- **Pivot table** (calendar heatmap): row dimension `iso_week`, column
  dimension `iso_weekday`, metric `rate`.
- **Line chart**: dimension `date`, metric `rate`, reference line at
  `target_pct`.

---

## 4. Filters (top of page, apply to all sections)

Add as page-level filter controls, positioned above the three sections:

- **Filter control** on `habit_type`, default value **core**. This is the
  optional-habits switch — flipping it to "optional" or clearing it
  brings the second-coffee-style habits back into every chart.
- **Filter control** on `section_name` (Morning / Work / Evening / Daily
  Reminders).
- **Filter control** on `habit`, multi-select enabled.

**Rate charts need one more guard**: every chart whose metric is `rate`
(scorecards, gauge, bar, line, heatmap) additionally gets a **chart-level**
filter `habit_type = core`, so an optional habit never dilutes a rate
unless someone deliberately widens the page-level filter control to
include it. The count-based charts (`done_count`, `pending_count`,
`missed_count`, the Today table, the weekly pivot) do **not** get this
extra filter — they should reflect whatever the page-level control shows.

---

## 5. Verification

After building:

1. The week pivot (Section 2) shows Monday → Friday in calendar order,
   with `−1` only on days that have already finished (today and future
   days read `0`, never red, until the day is over).
2. Flipping the `habit_type` filter control to include "optional" changes
   the count-based charts but not the rate-based ones until the
   chart-level `habit_type = core` filters are removed too.
3. The Section 3 "current streak" table matches Section 1's per-habit
   `streak` values for today.
4. Nudging `target_pct` (data source parameter, not the page) moves every
   gauge and reference line without touching the underlying data.
