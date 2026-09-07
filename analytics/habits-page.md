# Habits page — Looker Studio build recipe

A single Looker Studio page built entirely on `HabitDaily`
(see [`../sheets/todoist/schema-todoist.md`](../sheets/todoist/schema-todoist.md#tab-5-habitdaily)).
No code ships for this part — Looker has nothing to commit — so this doc is
the build recipe, precise enough to follow click-by-click. Rebuild from here
if the page is ever lost or needs to be recreated from scratch.

**As built**, a few labels differ from the design names used throughout this
doc; the recipe uses the as-built ones so a rebuild reproduces the same
page rather than a differently-labelled one:

| Design name | As built in Looker |
| --- | --- |
| Page **Habits** | Page **Performance** |
| Section 1 table "Today's Alignment" / "Still to Do" | Table **Pending** |
| Card "Target to Hit" | Card **Remaining to Target** |
| Dimension `section_name` | Displayed as **Day's Moment** |

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
| `target_pct` | parameter, type **Number**, default `0.8` | reference lines, and the two fields below |
| `rate_vs_target` | `rate - target_pct` | the coloured scorecard and the per-habit bar — colour rules compare it to `0` |
| `attainment` | `rate / target_pct` | the gauge — `1.0` is exactly on target |
| `to_target` | `CEIL(target_pct * SUM(due)) - SUM(completed)` | Today's "Remaining to Target" card — check-offs still needed |

**Adding the `target_pct` parameter**: data source editor → **Add a
parameter** → name `target_pct` → type Number → default value `0.8`. It
then appears both as a field (usable inside `rate_vs_target` and
`attainment`) and, on any chart, as a reference-line value type — reference
lines accept `constant value`, `metric`, or `parameter`, and only
single-valued numeric parameters qualify.

**Why the target lives inside the metric.** A conditional formatting rule is
based on the chart's own metric, and the value it compares against must be a
literal or *another metric in the same chart*. A scorecard holds one metric,
so a card showing `rate` cannot be coloured by `rate_vs_target` — the field
simply is not in that chart. The gauge is worse off still: **its axis
min/max, its range limits and its target value are all typed constants** —
no field, no metric, no parameter. The Style panel gives you plain numeric
spinners with no field picker, and there is no way in. Reference lines
*would* accept `constant` / `metric` / `parameter`, but they exist only on
bar, line, area, combo and time-series charts, never on a gauge.

The way around it is to move the target into the metric and compare against
a fixed zero point: chart `rate_vs_target` and colour at `0`, or chart
`attainment` and band around `1`. The parameter stays live either way,
because it is inside the field's formula — nudge `target_pct` and every one
of these moves together. Charting `rate` with a literal threshold (`>= 0.8`)
also works, but the threshold then stops following the parameter, which is
the drift this page is built to avoid.

**The daily gauge is the one deliberate exception.** Wanting an *integer*
count of habits done today, on a dial, rules out both escapes above — they
both work by turning the number into a ratio. Two alternatives were
considered and passed over:

| Alternative | Gets you | Costs you |
| --- | --- | --- |
| Bar chart, date range Today, metrics `done_count` and `target_count` = `CEIL(target_pct * SUM(due))` | An integer *and* a target that follows the parameter; both bars read `0` on a rest day, so nothing looks like a failure | No dial — two bars side by side |
| Gauge on `attainment`, axis `0`–`1.25`, banded around `1.0` | A dial that follows the parameter live | Reads `0.86`, not `14` — a ratio again, which is what the integer gauge exists to avoid |

The gauge keeps its hardcoded axis and target instead, and pays for it with
the upkeep in [§6](#6-constants-to-re-tune-by-hand). If the roster ever
churns often enough that hand-editing `26` becomes a chore, the bar-chart
row above is the migration.

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

- **Gauge** "Done Today": metric `done_count`. Style → Axis min `0`, axis
  max `26`, a single range `0`–`26`, **Show target** on with target value
  `21`, and **decimal precision `0`** — it is a count of things, so it must
  read `14`, never `14.0`. The two constants are explained under
  [Reading the daily gauge](#reading-the-daily-gauge) and listed in
  [§6](#6-constants-to-re-tune-by-hand); they are the only numbers on the
  page that do not follow the data.
- **Scorecard** "Done / Due": metric `done_count`, comparison metric
  `SUM(due)`.
- **Scorecard** "Owed Today": metric `SUM(due)`. No calculated field needed
  — `due` is a real column and this is a plain aggregation. This is the
  rest-day tell: `0` here means nothing was owed today, which is what
  explains every other zero in the section.
- **Scorecard** "Still Open": metric `pending_count`.
- **Scorecard** "Remaining to Target": metric `to_target`, number format
  **Number**, 0 decimals; conditional formatting on the card's own metric —
  `> 0` amber, `<= 0` green. A whole number of check-offs, not a
  percentage: "2" means two more habits today and the target is met.
- **Text label**, beside the section header: *"A day with 0 owed is a rest
  day, not a failed one."* Weekends and rest days score every habit
  `not_due`, so the whole section legitimately reads zero — the label is
  what stops that from looking like a collapse.
- **Table** "Pending": dimensions `section_name` (renamed **Day's Moment**),
  `due_time`, `habit`, `status`, `streak`; sort by `due_time` ascending;
  conditional formatting on `status` (`pending` amber, `done` green,
  `missed` red). Two chart-level filters:
  - `due = 1` — so a rest day renders an empty table instead of listing
    every habit as `not_due`.
  - `status = pending` — so the title is honest. **Check this one is
    actually applied**: a "Pending" table showing `not_due` rows means it
    is missing.

  Drop the `status` filter (keeping `due = 1`) if you would rather see the
  full day, done and pending together, instead of a pure to-do list.

#### Reading the Today cards

| Card | Reads | Meaning |
| --- | --- | --- |
| Done / Due | `3` with `8` beneath | Three of the eight habits owed today are checked off. "Due" counts every habit that exists today on a weekday — weekends and habits that did not exist yet are never owed, so they never inflate the denominator |
| Owed Today | `8` | How many habits today actually asks for. **`0` means a rest day** — and then every other card on the row reading zero is correct, not broken. Note that Done / Due shows `N/A` for its comparison on such a day, because a percentage against a zero denominator is undefined |
| Still Open | `5` | Owed today, not yet done. This is `pending`: the day is not over, so these are not misses. It falls to `0` as you finish the day, and after midnight the leftovers become `missed` and this card reads `0` for that date |
| Remaining to Target | `2` | Two more check-offs to reach `target_pct` (80%) of today's owed habits. Zero or negative means the target is met — the card turns green. It moves with the parameter: raise the target and the number goes up |

#### Reading the daily gauge

The gauge answers a different question from the cards beside it. The cards
are all relative to *today's* demand; the gauge is an absolute count against
a **fixed yardstick** — how much of the whole habit roster you got through.
That is why its two numbers are typed constants rather than fields.

| Element | Means | Caveat |
| --- | --- | --- |
| Needle | Check-offs completed today, as a whole number | Counts `done` rows only — `pending` earns no partial credit, so the needle climbs through the day and is only final after midnight |
| Axis max `26` | The full habit roster, a fixed yardstick — *not* today's denominator | Hand-maintained. Re-tune it whenever a habit is added to or archived in Todoist, or the dial silently rescales against a roster that no longer exists |
| Target tick `21` | What a good weekday looks like, roughly 80% of the roster | Hand-maintained, and it **assumes a full weekday**. On a weekend, a rest day, or any light day, the needle sits far left of the tick even though nothing was missed — read "Owed Today" before reading the gauge as a failure |

That last caveat is the price of keeping an integer dial, and it is
deliberate: the target tick cannot be made to follow `target_pct`, for the
reasons in [§2](#2-calculated-fields-on-qs---habitdaily) above. The
"Remaining to Target" card next to it *is* parameter-driven, and is the one
to trust when the two disagree.

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
- **Gauge**: metric `attainment` (`1.0` = exactly on target). Style →
  ranges: `0`–`0.75` red, `0.75`–`1` amber, `1`–`1.25` green, max `1.25`.
  The range limits are static by design — `attainment` already divides by
  the parameter, so the bands track the target without being parameters
  themselves.
- **Bar chart** (cadence): dimension `date`, metrics `done_count` and
  `SUM(due)`, stacked or side-by-side bars.

#### Reading the week cards

| Card | Meaning |
| --- | --- |
| rate (vs previous period) | Check-offs ÷ habits owed, Monday to now, with last week's same stretch as the comparison. **Today deflates it**: today's unfinished habits already count as owed but not yet done, so the number climbs as the day closes out. That is the intended pressure, not a bug |
| missed_count | Owed days that have finished with nothing recorded. Weekends never appear here (`not_due`), and today never does either (`pending`) — a miss only exists once its day is over |
| done_count | Total check-offs this week, optional habits included or not depending on the `habit_type` control |
| gauge (`attainment`) | Where the week sits against the target: needle at `1.0` is exactly on target, left of it is behind |

### Section 3 — This month

Chart date range: **This month**; comparison = **previous period** where
supported.

- **Scorecard** "Habits Completed": metric `done_count`.
- **Scorecard**: metric `rate`, comparison = previous month.
- **Scorecard** "Best Streak": metric `MAX(streak)`.
- **Table** "Current Streak": same source, chart-level date range override
  to **Today** (today's row carries the current streak through the day);
  dimensions `habit`, `streak`; sort `streak` descending.
- **Bar chart** (horizontal): dimension `habit`, metric `rate`, sorted
  descending, with a **reference line** of type *parameter* → `target_pct`.
  The line is what separates the habits carrying the month from the ones
  dragging it. For per-bar colour instead, switch the metric to
  `rate_vs_target` (bars diverge around zero, worst first when sorted
  ascending) and add conditional formatting on that metric: `< 0` red,
  `>= 0` green — bar charts do support conditional formatting, under the
  same compare-to-a-constant limit.
- **Pivot table** (calendar heatmap): row dimension `iso_week`, column
  dimension `iso_weekday`, metric `rate`.
- **Line chart**: dimension `date`, metric `rate`, reference line at
  `target_pct`.

#### Reading the month cards

| Card | Meaning |
| --- | --- |
| Habits Completed | Every check-off this month, summed across habits — the pride number, and the one that grows all month |
| rate (vs previous month) | Check-offs ÷ habits owed for the month so far, against the same measure last month. Days still to come are not owed yet, so they do not drag it down |
| Best Streak | The longest consecutive-done run reached this month, by whichever habit held it. It reads the highest `streak` value on any row in range, so a run that started in August and ended on 3 September still counts — the streak column carries across months |
| Current Streak (table) | Today's live streak per habit. It has its own **Today** date range because the streak lives on each day's row; over a month range you would get the month's maximum instead of where you stand right now |

---

## 4. Filters (top of page, apply to all sections)

Add as page-level filter controls, positioned above the three sections:

- **Filter control** on `habit_type`, default value **core**. This is the
  optional-habits switch — flipping it to "optional" or clearing it
  brings the second-coffee-style habits back into every chart.
- **Filter control** on `section_name` (Morning / Work / Evening / Daily
  Reminders).
- **Filter control** on `habit`, multi-select enabled.

**Rate charts need one more guard**: every chart built on `rate` — including
the ones charting it through `to_target`, `attainment` or `rate_vs_target`
(the "Remaining to Target" card, the Section 2 `attainment` gauge, the
per-habit bar, the line, the heatmap) — additionally gets a **chart-level**
filter `habit_type = core`, so an optional habit never dilutes a rate
unless someone deliberately widens the page-level filter control to
include it.

The count-based charts do **not** get this extra filter — they should
reflect whatever the page-level control shows. That includes `done_count`,
`pending_count`, `missed_count`, the Today table, the weekly pivot, and
**the Section 1 daily gauge**, which counts `done_count` rather than a rate.
One consequence worth knowing: including optional habits raises the gauge
needle without raising its `26` axis, so the dial reads generously on a day
you check off extras.

---

## 5. Verification

After building:

1. The week pivot (Section 2) shows Monday → Friday in calendar order,
   with `−1` only on days that have already finished (today and future
   days read `0`, never red, until the day is over).
2. Flipping the `habit_type` filter control to include "optional" changes
   the count-based charts but not the rate-based ones until the
   chart-level `habit_type = core` filters are removed too.
3. The Section 3 "Current Streak" table matches Section 1's per-habit
   `streak` values for today.
4. Nudging `target_pct` (data source parameter, not the page) changes the
   "Remaining to Target" count, the Section 2 `attainment` gauge's position
   against its bands, and every reference line — without touching the
   underlying data. If a number, colour or line does *not* move, that chart
   is using a literal threshold rather than `to_target` / `attainment` /
   `rate_vs_target`. **The Section 1 daily gauge is the exception**: its
   target tick must *not* move, because it is a constant. That is expected
   — see [§6](#6-constants-to-re-tune-by-hand).
5. The Section 1 gauge reads a whole number (`14`, not `14.0`). If it shows
   a decimal, its decimal precision is still at the default.
6. **On a rest day** (any weekend, or a day with nothing owed): "Owed Today"
   reads `0`, the Today table is empty rather than listing every habit as
   `not_due`, and the rest-day text label is visible. The gauge will still
   sit at `0` against its `21` tick — that is the accepted trade-off, and
   the label plus "Owed Today" are what keep it legible.
7. **On a full weekday**: "Owed Today" reads the real weekday denominator
   (not `26`), the gauge needle climbs through the day as habits are
   checked off, and "Remaining to Target" falls to `0` once the target is
   met.
8. The Today table titled "Pending" contains no `not_due` and no `done`
   rows. If it does, its `due = 1` or `status = pending` chart-level filter
   is missing.
9. `streak` in the Today table is non-zero for habits with a run behind
   them. An entire column of `0` is a data-side symptom — see
   [§7](#7-troubleshooting).

---

## 6. Constants to re-tune by hand

Everything else on this page follows the data or the `target_pct` parameter.
These two do not — Looker Studio gauges accept typed numbers only for their
axis, ranges and target (see the explainer in [§2](#2-calculated-fields-on-qs---habitdaily)),
so they drift unless someone edits them.

| Where | Current | What it represents | Re-tune when |
| --- | --- | --- | --- |
| Section 1 gauge → Style → Axis max (and the single range limit) | `26` | The full habit roster | A habit is added to, or archived in, Todoist. Check it against `COUNT_DISTINCT(task_id)` over a recent full weekday |
| Section 1 gauge → Style → Target value | `21` | A good weekday, ~80% of the roster | The definition of a good day changes, or the roster has moved enough that `21` is no longer close to `target_pct` × the roster |

Keep the target roughly in step with `target_pct`: if you raise the
parameter to `0.9`, the gauge tick should move too, or the dial and the
"Remaining to Target" card will start telling different stories on the same
day.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `due_time` shows `null` for every row | `dueTimeOf()` returns `""` when a recurrence rule carries no time of day (`every day` has none; `every day at 09:10 am` does), and Looker renders an empty dimension value as `null` | Nothing — expected. See [`due_time` in the schema](../sheets/todoist/schema-todoist.md). To hide it, set the field's **Missing data** style to blank, or add the time to the Todoist recurrence rule |
| Every `streak` reads `0` | The `HABIT_DAILY_HEADER` layout guard in `getOrCreateHabitDailySheet()` cleared the tab on deploy, which drops the synthetic history the streaks are threaded from | Re-run `backfillHabitDaily()`, then `synthesizeHabitDailyHistory()` once, in that order |
| Today section is empty in the morning | The day's rows are written by the hourly `syncTodoistIntraday()` run, which self-limits to 07:00–23:00 | Nothing before 07:00. After that, check the hourly trigger is installed |
| "Done / Due" comparison reads `N/A` | The comparison is a percentage against `SUM(due)`, and today's denominator is `0` | Nothing — it is a rest day. "Owed Today" reading `0` confirms it |
| A rate chart ignores the `habit_type` control | Rate charts carry their own chart-level `habit_type = core` filter by design (see [§4](#4-filters-top-of-page-apply-to-all-sections)) | Remove the chart-level filter if you want the control to reach it |
