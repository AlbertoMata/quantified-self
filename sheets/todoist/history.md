# Todoist data — history

Changes that alter how **existing rows** read. Every one of these is a seam in the data:
rows on either side are both correct, but they mean slightly different things. Each tab doc
links here rather than restating its own caveat.

Nothing below needs fixing — the rows are not garbage, they just have to be read with the
right rule.

---

## 2026-09-08 — life areas arrive

Three parent projects (`💼 Work`, `💰 Bills & Taxes`, `📋 Errands`) were created and the 16
existing projects nested under them. **No project was renamed**, so every `project_id` — and
therefore every historical row's `project_name` — is unchanged. Four `area-*` labels were
created and applied to all 135 open tasks outside `Habits`.

`Completions` gained columns **O `area`, P `area_source`, Q `was_overdue`**.

**Affects**: `Completions` cols O–Q.

**How to read old rows**: `area` is fully retroactive — it re-derives from `project_id`, which
every row has carried since the tab was created. `labels` (col G) is **not**: it is frozen at
capture, so a row from March cannot know about a label added in September. Consequently
historical rows resolve through the project tree and read `area_source = parent`, while rows
written from today on mostly read `label`. Both are correct; they are not the same claim.
**Filter on `area_source` before treating an area as declared.**

Rows written before this date have blank O–Q until `backfillCompletionAreas()` is run.

---

## 2026-09-08 — `BillCycle`, `AreaDaily` and `TaskDaily` begin

Three new tabs. Two of them have a floor that no backfill can lift:

- `TaskDaily` is **observed only**. Todoist keeps no history of what was open on a past day,
  and `item:updated` events carry no `section_id`, so both task presence and section age
  start accruing on this date. Its `section_age_seeded` column marks rows whose section age
  is a floor rather than a measurement — on the first run that is *every* row.
- `AreaDaily`'s `open` / `overdue` / `in_week` / `p1_open` columns are snapshots and start
  here too. Its `completed` column derives from `Completions` and reaches back normally;
  `counts_observed` distinguishes them. Backfilled rows leave the snapshot columns **blank,
  not zero** — a zero would claim nothing was open that day.

`BillCycle` is fully derived and reaches as far back as `Completions` does — but see the
repair note below, without which every cycle before 2026-08-10 is attributed to the wrong
month.

---

## 2026-08-10 — the spine begins

`syncRecurringStatus()` ran for the first time. Before this date there is **no snapshot of
which habits existed**, which is why `HabitDaily` cannot observe anything earlier.

**Affects**: `RecurringStatus` (no rows before this), `HabitDaily` (everything before this
day is synthetic — see below).

---

## 2026-08-10 — `completed_due_date` fix in `Completions`

The activity log's `due_date` has already advanced to the **next** occurrence by the time a
recurring completion event is written. The sync now reads `completed_due_date` instead.

**Affects**: `Completions.due_date` (col J). Rows written **before 2026-08-10** carry
next-occurrence semantics — a habit completion is dated a day, or a whole weekend, into the
future. Rows after it carry the occurrence actually completed.

**How to read old rows**: do not use `Completions.due_date` for habit-day attribution at
all. `HabitDaily` deliberately keys done-ness on the local day of `completed_at` (col A),
which never had this bug, and a rebuild would resurrect it if it read col J.

**This one is now repairable.** `repairCompletionDueDates()` re-reads the activity log for
the affected window and corrects col J in place. A plain backfill cannot: dedup is
`task_id|completed_at`, so re-fetching an already-present completion drops it rather than
rewriting it.

It matters far more for bills than for habits. A day's error on a daily habit is a rounding
issue; on a **monthly bill it is a whole cycle**, so `BillCycle` attributes every pre-fix
cycle to the following month until the repair has run. Rows the activity log can no longer
reach (Todoist retains roughly 12 months) keep their old value and are reported as unmatched
rather than blanked.

---

## 2026-08-20 — UTC → local date stamps

Nightly rows were stamped with `toDateString()` (UTC). The 23:30 local trigger is already
05:30 *tomorrow* in UTC, so every nightly row was labeled one day ahead — and
`days_overdue`, computed from that stamp, ran one too high. Fixed to `localDateString()`.

**Affects**, for rows written before 2026-08-20:

| Column | Symptom |
| --- | --- |
| `Overdue.snapshot_date` | One day ahead |
| `Overdue.days_overdue` | One too high |
| `KarmaStats.date` | One day ahead — shift back a day when joining with the `Health` sheet |
| `RecurringStatus.snapshot_date` | One day ahead |

**How to read old rows**: a snapshot labeled `D` was taken at 23:30 of `D−1`, so read it as
"the state at the *start* of day `D`". Every consumer's date comparison tolerates that. The
dangling last label self-healed — the replace-today pass overwrote it on the first post-fix
nightly run.

---

## 2026-08-20 — recurrence migration

Every habit in the Habits project switched from `every day` to `every workday`, and the two
Daily Reminders tasks gained workday recurrence — they enter the spine, and therefore
`HabitDaily`, only from this date.

**Affects**: `RecurringStatus.recurrence_string` and `HabitDaily.recurrence_string`. Spine
rows written before the migration still carry the old `every day` strings.

**How to read old rows**: the weekend rest-day policy deliberately overrides them, on the
grounds that weekends were never part of the contract. Any future *synthesized* pre-Aug-10
spine must apply the same rest-day rule rather than trusting those historical strings.

---

## Synthetic `HabitDaily` history

Rows dated before the spine's first day (2026-08-10) were written by
`synthesizeHabitDailyHistory()` — **reconstructed from `Completions`, not observed**.

- **Marker**: a blank `due_date` (col K). No snapshot existed to fill it.
- **Floor**: each habit's synthetic window starts at max(its Todoist `added_at`, its first
  captured completion). A habit never captured before the spine began is skipped entirely
  rather than painted "missed" — a deliberate undercount, since misses can be lost but must
  never be fabricated.
- **Fidelity**: section, labels, priority and recurrence are the habit's *current* values,
  not historical ones.
- **Durability**: safe to re-run, and normal rebuilds never touch the block. But a **layout
  change clears the whole tab**, which silently drops it — re-run
  `synthesizeHabitDailyHistory()` once afterwards. See
  [schema/habit-daily.md](schema/habit-daily.md).

---

## First run of the "In Review" source

Not a dated event — it happens whenever the source is first deployed against an empty
`TODOIST_IN_REVIEW_PREV` Script Property.

The previous membership set is empty on that run, so **every task currently sitting in an
In Review section is backfilled with that day's date**. Delete those rows manually if only
true go-forward moves are wanted. See [schema/completions.md](schema/completions.md).
