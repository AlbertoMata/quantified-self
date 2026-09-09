# Tab: `TaskDaily`

One row per open task per day — the card-level companion to `AreaDaily`'s counts.

| | |
| --- | --- |
| **Sheet · tab** | `quantified-self-todoist` · `TaskDaily` |
| **Written by** | `syncTaskDaily()` in [`../todoist-task-daily.gs`](../todoist-task-daily.gs) |
| **Strategy** | Replace today's rows, then append |
| **History** | **Observed only.** Accrues forward; no backfill is possible |

---

## What it is

A daily snapshot of every open task, area-aware. It answers *what has been sitting longest*
(errands) and *where is the work stuck* (work) — questions that need per-card aging, which a
counts-only rollup cannot express.

**Nothing here can be backfilled.** Todoist keeps no history of what was open on a past day,
and `item:updated` events carry no `section_id`, so section history in particular can only
ever be observed forward from the day this tab starts running.

---

## Columns

| # | Column | Type | Example | Notes |
|---|---|---|---|---|
| A | `snapshot_date` | YYYY-MM-DD | `2026-09-08` | Local day |
| B | `task_id` | string | `6hCMVmVg4338cJCc` | |
| C | `content` | string | `Pay predial` | |
| D | `project_name` | string | `Bills` | |
| E | `area` | string | `bills-taxes` | See [`../area-contract.md`](../area-contract.md) |
| F | `area_source` | string | `parent` | `label` · `project` · `parent` · `default` |
| G | `in_week` | boolean | `FALSE` | Orthogonal to area — `Week` is a focus view, not a category |
| H | `section_name` | string | `In Progress` | **Blank where the project has no sections** — that is an absence, not a stage |
| I | `work_stage` | string | `active` | Normalised: `backlog` · `active` · `review` · `done` · `blocked` · `canceled` · `other` · blank |
| J | `labels` | string | `home,bills` | Comma-separated |
| K | `priority` | integer 1–4 | `4` | API scale: **4 = `p1`, highest** |
| L | `due_date` | YYYY-MM-DD | `2026-08-08` | |
| M | `deadline_date` | YYYY-MM-DD | `2026-07-01` | **A fossil on recurring tasks** — never use for urgency |
| N | `is_recurring` | boolean | `FALSE` | |
| O | `is_subtask` | boolean | `FALSE` | |
| P | `added_on` | YYYY-MM-DD | `2026-03-16` | |
| Q | `days_in_project` | integer | `176` | |
| R | `section_entered_on` | YYYY-MM-DD | `2026-09-08` | See seeding below |
| S | `days_in_section` | integer | `0` | |
| T | `section_age_seeded` | boolean | `TRUE` | **`TRUE` means R is a floor, not an observation** |
| U | `days_overdue` | integer | `31` | Blank unless actually overdue |
| V | `is_exit` | boolean | `FALSE` | `TRUE` on the terminal row for a task that has left |

---

## The four mechanisms

### 1. Section age is seeded in four cases

Todoist does not record when a task entered a section, so this can only be observed forward.

| Situation | `section_entered_on` | `section_age_seeded` |
| --- | --- | --- |
| Prior row, same section | carried forward | carried forward |
| Prior row, **different** section | today — an observed move | `FALSE` (exact) |
| No prior row, in a **birth** section (`Backlog`) | `added_on` | `TRUE` |
| No prior row, anywhere else | today — **a floor** | `TRUE` |

**Filter on `section_age_seeded = FALSE` before averaging section age.** A seeded value is a
lower bound: a card that had already sat in review for three months reads as 0 days on the
first snapshot. Once seeded, the flag is carried for the life of the task, so a floor is
never quietly reclassified as an observation.

### 2. Exit rows

A task present yesterday and absent today gets one terminal row with `is_exit = TRUE`,
carrying its last observed section. Without it a completed task simply vanishes and nothing
records how long it took.

The prior-state read **excludes** `is_exit` rows. If it did not, a task that left last week
would emit a fresh exit row every night forever.

### 3. Prior state is read strictly *before* today

Never today's own rows. The intraday trigger runs hourly, so reading today's half-written
rows would reset every section age to zero on the second run of the day.

**Verification**: run `syncTaskDaily()` twice in one day. The row count must not change and
every `section_entered_on` must be identical.

### 4. Layout changes archive, never clear

These rows are observations. Nothing can re-fetch what was open last Tuesday, so an
incompatible header change renames the tab to `TaskDaily-archive-<date>` and starts a fresh
one, rather than wiping it the way a derived tab can be wiped.

---

## `work_stage` and the rename tripwire

Board vocabularies are incompatible across projects: `Study/Reading` runs Backlog / In
Progress / **Quiz** / Done, `Ascensus` swaps Done and Blocked, and several projects have no
sections at all. `work_stage` maps them onto one scale so "how much is in review" can be
asked across projects. `Quiz` folds into `review` — it is Study/Reading's verification step.

An unrecognised section name returns **`other`**. That is deliberate: a section renamed in
Todoist shows up as a growing `other` bucket instead of silently disappearing from every
chart. A non-zero `other` count means the map in
[`../todoist-task-daily.gs`](../todoist-task-daily.gs) needs a new entry.

---

## Size

~200 open tasks × 22 columns × 365 days ≈ **1.6M cells a year**, against a 10M-cell limit
shared by **every tab in this spreadsheet**. Fine for two to three years, then it is not.

`pruneTaskDaily(keepDays)` exists for that day and is **deliberately manual** — silently
deleting observations that cannot be rebuilt is not something a nightly trigger should do.
The sync logs a warning as the ceiling approaches. `AreaDaily` keeps the daily counts either
way, so pruning costs card-level detail, not the trend.

---

## Related

- [`area-daily.md`](area-daily.md) — the counts companion
- [`../area-contract.md`](../area-contract.md) — how a task gets its area
- [`bill-cycle.md`](bill-cycle.md) — bills are scored on cycles, not days
