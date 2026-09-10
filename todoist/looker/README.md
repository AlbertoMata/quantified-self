# Analytics

All analytics run in Looker Studio, blending four Google Sheets on a shared `date` key. The report is also embedded in Obsidian via the Custom Frames plugin (see `obsidian/README.md`).

---

## Data sources

Add these as separate data sources in Looker Studio (one per tab):

| Data source name | Sheet | Tab |
| --- | --- | --- |
| QS - Log | quantified-self-log | Log |
| QS - Health | quantified-self-health | Health |
| QS - Completions | quantified-self-todoist | Completions |
| QS - Overdue | quantified-self-todoist | Overdue |
| QS - Karma | quantified-self-todoist | KarmaStats |
| QS - Time Entries | quantified-self-everhour | TimeEntries — **historical**, no longer written |
| QS - Daily Summary | quantified-self-everhour | DailySummary — **historical**, no longer written |
| QS - HabitDaily | quantified-self-todoist | HabitDaily |
| QS - RecurringStatus | quantified-self-todoist | RecurringStatus |
| QS - BillCycle | quantified-self-todoist | BillCycle |
| QS - AreaDaily | quantified-self-todoist | AreaDaily |
| QS - TaskDaily | quantified-self-todoist | TaskDaily |

**To add each**: Looker Studio → Add data → Google Sheets → select the sheet → select the tab → Add.

`QS - HabitDaily` and `QS - RecurringStatus` power the **Habits** page — a separate build,
since it has its own calculated fields, layout, and filters. See
[`habits-page.md`](habits-page.md) for the full recipe.

`QS - BillCycle`, `QS - AreaDaily` and `QS - TaskDaily` power the life-area pages (Bills,
Errands, Work, Areas overview) — see
[`../docs/plans/life-areas.md`](../../docs/plans/life-areas.md) Phase 4. Two of them carry an
honesty flag that **must** be filtered on before charting:

| Source | Filter first | Why |
| --- | --- | --- |
| `QS - AreaDaily` | `counts_observed = TRUE` before plotting `open` / `overdue` / `in_week` / `p1_open` | Those columns are snapshots and are **blank** on backfilled rows. Unfiltered, every series appears to start at nothing and climb |
| `QS - TaskDaily` | `section_age_seeded = FALSE` before averaging `days_in_section` | A seeded value is a lower bound, not a measurement — on the first run it is every row |
| `QS - TaskDaily` | `is_exit = FALSE` for "what is open now" | Exit rows are terminal records of departed tasks |

`QS - BillCycle` needs no such filter, but two things must be said on any chart built from it.
**It measures closure, not payment** — Todoist knows when you ticked the box, never when money
moved, which is why the statuses read `closed` / `closed_late` rather than paid/late. Title
those charts accordingly ("cycles closed late", not "bills paid late"). And `was_overdue`
**blank means unknown, not on-time**, while `deadline_date` is excluded from every urgency
calculation because Todoist never advances a deadline when a task recurs.

---

## Calculated fields

Add these in the data source editor before building charts:

| Source | Field name | Formula | Purpose |
| --- | --- | --- | --- |
| QS - Log | `date` | `TODATE(timestamp, 'YYYY-MM-DD HH:MM:SS')` | Enable date-level joins (Log has ISO timestamps, not plain dates) |
| QS - Log | `mood_value` | `IF(event_type = 'mood', CAST(value AS NUMBER), NULL)` | Numeric mood for averaging |
| QS - Log | `focus_minutes` | `IF(event_type = 'focus_end', CAST(value AS NUMBER), NULL)` | Focus block duration |

---

## Blends

Looker Studio's **Blend Data** feature joins sources on `date`. Use a **left join** from the Health source (most complete daily coverage) to the others.

**To create a blend**: open a chart → click the data source → **Blend data** → add sources → set join key = `date` on each.

### Recommended blends

| Blend name | Left | Right sources | Join key | Use case |
| --- | --- | --- | --- | --- |
| `daily_wellbeing` | QS - Health | QS - Log (avg mood), QS - Karma | `date` | Mood vs HRV vs task completion |
| `focus_vs_time` | QS - Log (focus_end) | QS - Daily Summary | `date` | Focus block minutes vs billable hours |
| `habit_vs_sleep` | QS - Completions | QS - Health | `date` | Habit streak vs sleep quality |

Todoist-specific recipes — the parent-task self-blend, the (frozen) Everhour time-per-task chain,
and the karma/health join — are in [`todoist-blends.md`](todoist-blends.md).

---

## Suggested charts

### Single-source charts

| Chart | Source | Dimension | Metric | What it shows |
| --- | --- | --- | --- | --- |
| Time series | QS - Log | `date` (calculated) | Count | Event logging frequency |
| Time series | QS - Log | `date` | Avg `mood_value` | Mood trend over time |
| Bar | QS - Log | `event_type` | Count | Most-logged event types |
| Scorecard | QS - Log | — | Avg `mood_value` (last 7d) | Rolling mood average |
| Time series | QS - Health | `date` | `hrv_ms`, `sleep_hours` | Recovery trends |
| Scorecard | QS - Health | — | Avg `hrv_ms` (last 7d) | HRV baseline |
| Time series | QS - Karma | `date` | `karma_delta` | Daily productivity change |
| Bar | QS - Completions | `project_name` | Count | Completions by project |
| Time series | QS - Daily Summary | `date` | `billable_hours`, `total_hours` | Time tracked per day |
| Scorecard | QS - Daily Summary | — | Avg `billable_pct` (last 30d) | Billing efficiency |

### Blended charts

| Chart | Blend | Metrics | What it shows |
| --- | --- | --- | --- |
| Scatter | `daily_wellbeing` | X: `sleep_hours`, Y: `mood_value` | Sleep quality vs next-day mood |
| Combo line | `daily_wellbeing` | `hrv_ms` + `tasks_completed` | Recovery vs output |
| Scatter | `focus_vs_time` | X: `focus_minutes`, Y: `billable_hours` | Focus blocks vs actual billed time |
| Line | `habit_vs_sleep` | Habit count + `sleep_deep_hours` | Habit consistency vs deep sleep |

---

## Tips

- Cast `value` to **Number** in QS - Log field settings for mood/food/caffeine
- Use a **Date range control** on each page, defaulted to "Last 30 days"
- Add a **Filter control** on `event_type` to isolate specific behaviours in the Log
- Add a **Filter control** on `project_name` in QS - Completions to focus on habit projects
- Pin the report URL in Obsidian via Custom Frames for a single-pane view (see `obsidian/README.md`)

---

## Embedding in Obsidian

1. In Looker Studio: **File → Share → Embed report** → copy the embed URL
2. In Obsidian: install **Custom Frames** plugin → add a frame with that URL
3. Access via command palette: `Custom Frames: Open Quantified Self`

---

## Phase 2

When the SwiftUI app ships, analytics move in-app using **Swift Charts** with data from Supabase. Looker Studio remains useful for exploratory analysis and week/month retrospectives.
