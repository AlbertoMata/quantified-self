# Todoist → Sheets

Google Sheet name: `quantified-self-todoist`  
Populated by: the standalone Apps Script project in this directory — entry point `syncTodoist()` in [`todoist-sync.gs`](todoist-sync.gs) (nightly trigger at 23:30, plus `syncTodoistIntraday()` hourly between 07:00 and 23:00)

Five tabs, each capturing a different shape of Todoist data. The first four are fetched from the Todoist API; `HabitDaily` is derived from the other tabs (only its one-time history synthesizer touches the API, to read each habit's `added_at`).

---

## Tabs

| Tab | What it holds | Shape | Strategy | Schema |
| --- | --- | --- | --- | --- |
| `Completions` | One row per completed task, one-off and recurring | Event log | Incremental append | [schema/completions.md](schema/completions.md) |
| `Overdue` | Tasks due but not completed | Daily snapshot | Replace today's rows | [schema/overdue.md](schema/overdue.md) |
| `KarmaStats` | Todoist's own productivity metrics | One row per day | Upsert by `date` | [schema/karma-stats.md](schema/karma-stats.md) |
| `RecurringStatus` | Every active recurring task and its due date | Nightly snapshot | Replace today's rows, then append | [schema/recurring-status.md](schema/recurring-status.md) |
| `HabitDaily` | Dense habit × day grid, including skipped days | Derived from the two above | Windowed rebuild | [schema/habit-daily.md](schema/habit-daily.md) |

`RecurringStatus` is the **spine** of `HabitDaily` — the only tab that records a habit's
existence on days nothing happened — and `Completions` is the **truth** about whether it
was checked off. That is why `HabitDaily` runs last in `syncTodoist()`.

---

## Also in this directory

| Doc | What it answers |
| --- | --- |
| [habits-contract.md](habits-contract.md) | How a habit is authored in Todoist: the `habits` / `sub-habits` labels, how to add a step, what counts as a tracked habit |
| [history.md](history.md) | Dated timeline of changes that affect how old rows read — the 2026-08-10 spine start, the 2026-08-20 date-stamp fix and recurrence migration |
| [`../../docs/todoist/architecture.md`](../../docs/todoist/architecture.md) | Script structure: module map, shared utility layer, external API contract, porting notes |
| [`../../analytics/todoist-blends.md`](../../analytics/todoist-blends.md) | Looker Studio recipes built on these tabs |
| [`../../analytics/habits-page.md`](../../analytics/habits-page.md) | The full Looker build recipe for the Habits page, built on `HabitDaily` |

---

## Scripts

All six `.gs` files are **one** Apps Script project (`quantified-self-sync`), sharing a flat
global scope — see [architecture §1](../../docs/todoist/architecture.md#1-runtime-model).

| File | Writes |
| --- | --- |
| [todoist-sync.gs](todoist-sync.gs) | Orchestrator; `Overdue`, `KarmaStats`, `RecurringStatus` |
| [todoist-sync-completions.gs](todoist-sync-completions.gs) | `Completions` |
| [todoist-sync-sections.gs](todoist-sync-sections.gs) | The "In Review" source feeding `Completions` |
| [todoist-habit-daily.gs](todoist-habit-daily.gs) | `HabitDaily` |
| [todoist-sync-utils.gs](todoist-sync-utils.gs) | Nothing — shared HTTP, caching, cursor state |
| [todoist-reschedule-habits.gs](todoist-reschedule-habits.gs) | Nothing — the only path that **writes back to Todoist**, run manually |

---

## Script Properties required

Set these in the Apps Script project (**Project Settings → Script Properties**):

| Key | Value |
|---|---|
| `TODOIST_TOKEN` | Bearer token from [todoist.com/app/settings/integrations/developer](https://todoist.com/app/settings/integrations/developer) |
| `TODOIST_SPREADSHEET_ID` | ID from the Google Sheets URL: `docs.google.com/spreadsheets/d/<ID>/edit` |

The project also keeps runtime state in Script Properties (`TODOIST_LAST_SYNC`,
`TODOIST_IN_REVIEW_PREV`) — see
[architecture §5](../../docs/todoist/architecture.md#5-external-contract).

Full setup steps, including triggers and the first manual run, are in
[`../README.md`](../README.md#setup-quantified-self-todoist-and-quantified-self-everhour).
