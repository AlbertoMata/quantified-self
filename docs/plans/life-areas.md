# Life areas and bill cycles — design

**Status** (2026-09-08): **nothing implemented.** No label, sheet column, `.gs` file or Looker
page from this plan exists yet.

The work is organised into **four phases by where you do it** — Todoist, then Google Sheets,
then the repo, then Looker Studio. Each phase is one tool and one sitting; you never have to
ping-pong between them. Phase 3 is mine; Phases 1, 2 and 4 are yours, and this document is
written to be followed click-by-click.

**Phases 1 → 2 → 3 must run in that order.** Tagging feeds the area map, and the spreadsheet
columns must exist before any script writes to them — `Completions` has no header-writing code
and no layout guard, so a widened row array written against a stale header lands silently
misaligned. Phase 4 sub-phases can be built in any order once Phase 3 lands.

## Phase status

| Phase | What | Who / where | State |
| --- | --- | --- | --- |
| **1** | Categorize tasks with area labels | You — Todoist | not started |
| **2** | Prepare the spreadsheet tabs | You — Google Sheets | not started |
| **3** | Implement the scripts | Me — this repo | not started |
| **4a** | Bills report | You — Looker Studio | not started |
| **4b** | Errands report | You — Looker Studio | not started |
| **4c** | Work report | You — Looker Studio | not started |
| **4d** | Areas overview | You — Looker Studio | not started |

Update this table as phases complete, with the date. Once Phase 3.1 has shipped, run
`diagnoseAreas()` from the Apps Script editor and **believe its output over this document**.

---

## Context

Four things generate daily stress: **Work**, **Bills & Taxes**, **Errands**, **Habits**.
Habits are solved — `HabitDaily` plus the *Performance* page. The other three are not, and the
reason is structural.

Tracking today is organised by **Todoist project**. But an area of life spans several projects:
bills live across `Bills`, `Finance`, `Mortgage`, `Credit Cards` and `SAT`, and `Week`
deliberately mixes bills with errands because it is a prioritisation view rather than a
category. So no existing tab can answer *"how am I doing in each area of my life"* — the
question behind feeling lost about what to do next and whether anything is improving.

This plan introduces an **area** dimension spanning projects, backfills it across all existing
history, gives **Bills** a cycle-aware tab of its own, and gives **Work** its own tab and page.

---

## What the research settled

All verified live against the account on 2026-09-08.

| Finding | Consequence |
| --- | --- |
| **History reaches ≈ 2026-02** (Todoist Pro). The completed-tasks endpoint hard-errors above a **3-month span** | `MAX_COMPLETED_SPAN_MS = 90` is a correct *per-request* cap but a self-imposed *total* limit. Backfill = looping ≤90-day windows |
| `Completions` stores **`project_id` (col D)** on every row | Area is **fully retroactive by project** — no API call needed |
| `Completions` is **append-only**, dedup `task_id\|completed_at`; `labels` frozen at capture | Area **by label is go-forward only**. The key asymmetry in this plan |
| **`#"Study/Reading"` returns 0** though the project has 5+ open tasks; `#"Credit Cards"` works | The `/` breaks Todoist filter syntax even quoted. Fetch by **`project_id`**, never `#Name` |
| **Section vocabularies differ**: `Study/Reading` is Backlog / In Progress / **Quiz** / Done; `Ascensus` swaps Done and Blocked; `Bills`, `Finance`, `SAT`, `Challenger`, `Purchases` have **no sections** | An area cannot share one board vocabulary. Area tracking must be section-agnostic |

### Bills — the findings that reshaped the plan

| Finding | Consequence |
| --- | --- |
| **12 of 19 completion events since March carry `wasOverdue: true`.** Electricity's April cycle closed **33 days** late, internet's May cycle 21, the Invex card 23 | Bills are the worst-served, highest-stress area — hence report 4a first |
| Telcel, electricity and internet were checked off at **00:18:32 / :35 / :37 on 2026-09-08** — a catch-up sweep, 10 / 12 / 24 days after their cycles | **`completed_at` is worthless for on-time measurement**, and errs both ways: the 2026-08-04 sweep closed several cycles *early* |
| The activity payload already carries **`wasOverdue`** and **`completedDueDate`** | The honest signal exists and is discarded today |
| Every recurring bill is **`p1`** | Priority carries no ranking signal inside bills. Days-until-due is the only ordering |
| **`deadline` is a fossil** — Telcel's reads `2026-07-01` while its due date is `2026-09-29`; Todoist never advances a deadline on recurrence | Exclude `deadline_date` from bill urgency entirely |
| `Pay predial` is non-recurring, due `2026-08-08` — **31 days overdue** | One-off obligations must reach the bills report too |
| Only **9 open tasks** across all six bills projects | The area is small and stable — cheap to build, verifiable by eye |

### Backfill — what is and is not recoverable

One thing genuinely cannot be recovered, and it is worth stating plainly: **which board
column a card sat in on a past date**. `item:updated` events carry no `section_id`, so column
history only ever accrues forward from the day a snapshot tab starts running.

| Question | Recoverable? | How |
| --- | --- | --- |
| What did I complete, in which area, since February? | **Yes, fully** | `Completions` already holds `project_id` |
| Completions older than the sheet's earliest row? | **Yes, to ≈ 2026-02** | Loop the completed-tasks endpoint in ≤90-day windows |
| **Which bill cycles closed, and were they late?** | **Yes, to ≈ 2026-02** | Activity log carries `completedDueDate` + `wasOverdue`. **The best-backfilling thing in the system** |
| Which *label* did a task carry last March? | **No** | Frozen at capture; historical rows get `area_source = project` |
| Which board column did a card sit in last March? | **No** | Unchanged — `item:updated` carries no `section_id` |

---

## Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Areas | `work`, `bills-taxes`, `errands`, `habits` | Four, matching the four sources of stress |
| Area of a task | **Label → project default → `uncategorized`** | Most projects map cleanly; `Week` genuinely mixes. The label is the escape hatch |
| Never guess | An unmapped project yields `uncategorized` | A visible undercount beats invisible inflation — the bargain `habits-contract.md` already strikes |
| Honesty marker | `area_source`: `label` / `project` / `default` | Separates "you told me" from "I derived it", so a derived value can be excluded from a chart rather than silently averaged in as declared |
| Map keyed by | **`project_id`**, names in trailing comments | A rename would otherwise silently re-home every task |
| `Week` | Default `errands`, **plus an orthogonal `in_week` flag** | `Week` is a focus view, not a category. `in_week` stops a prioritised bill booking itself as an errand |
| Label naming | `area-work`, `area-bills-taxes`, `area-errands`, `area-habits` | The bare `work`, `bills`, `finance`, `taxes` labels exist meaning something else. Exact-token matching, so `work` never satisfies `area-work` |
| **Subprojects** | **Yes** — three new parent projects; area derived from `parent_id` | Makes the map self-maintaining: a project created under a parent is categorized automatically, with no code edit. Costs one widening of `getProjectMap()`, done once |
| Parent naming | **Emoji-prefixed**, and **no parent named `Habits`** | `getHabitsProjectId()` (`todoist-reschedule-habits.gs:198–204`) matches by exact name, first hit wins — a second `Habits` would silently break the habit reschedule. Distinct names also keep chart legends unambiguous |
| Existing projects | **Never renamed**, only moved | Nesting preserves `project_id`, so all history survives. A *rename* would fork `project_name` mid-history and create a seam for no benefit |
| **What is a bill** | A task whose area is `bills-taxes`. Recurring → one row per cycle; one-off → a single cycle row | The area label already marks it; no extra label needed |
| **Bill grain** | **Cycle**, not day | `HabitDaily`'s daily rule would score a monthly bill `missed` 30 days out of 31 |
| **On-time rule** | Todoist's **`wasOverdue` + `completedDueDate`** | The only honest signal given batch check-offs. Measures *did the cycle close late*, not *did money move late* |
| Amounts | **Not tracked** | No bill carries one today. A later, separate decision |
| Work | Own report, on the shared `TaskDaily` tab | Work is the spine and deserves its own page. A *separate tab* proved wrong: errands need the same card-level aging, so one area-aware tab serves both |

### The target project tree

Three new parent projects; the existing 19 move underneath, unrenamed. `Week`, `Habits` and
`Inbox` stay top-level and resolve by explicit override.

```text
💼 Work                 ← new parent          → area: work
   ├── Work
   ├── Study/Reading
   ├── Ascensus
   ├── Concentrix
   ├── Math
   └── Quantified Self

💰 Bills & Taxes        ← new parent          → area: bills-taxes
   ├── Bills
   ├── Finance
   ├── Mortgage
   ├── Credit Cards
   ├── SAT
   └── Purchases

📋 Errands              ← new parent          → area: errands
   ├── Challenger
   ├── Ford Focus
   ├── Home
   └── Misc

Habits                  top-level, unchanged  → area: habits
Week                    top-level, unchanged  → in_week flag + per-card labels
Inbox                   top-level             → area: errands
```

**`Week` stays out of the tree on purpose.** Its cards span every area — that is what makes it
a focus view rather than a category — so it gets an explicit `errands` default plus the
`in_week` flag, and its cards carry their own labels (Phase 1.4).

**No `Habits` parent.** A single child needs no parent, and creating one would break the habit
reschedule (see Decisions).

---

# Phase 1 — Categorize in Todoist

**You, in Todoist. No code involved.** Everything here is additive and reversible: you are
adding labels, not moving or renaming anything.

## 1.1 — Create the three parent projects

Create these as **new top-level projects**, spelled exactly, emoji included:

```text
💼 Work
💰 Bills & Taxes
📋 Errands
```

The emoji prefix is not decoration — it is what stops `💼 Work` colliding with your existing
`Work` project. Two projects with the same display name would be ambiguous in every chart
legend, and name-based lookups in the existing scripts resolve by first exact match.

**Do not create a `Habits` parent.** `getHabitsProjectId()` matches by exact name and takes the
first hit, so a second `Habits` project would make `rescheduleAllHabits()` target a project with
no sections and silently do nothing. `Habits` stays top-level and is its own area.

## 1.2 — Move the existing projects underneath

Drag each project onto its parent in the sidebar. **Do not rename anything.**

| Parent | Move under it |
| --- | --- |
| 💼 Work | `Work`, `Study/Reading`, `Ascensus`, `Concentrix`, `Math`, `Quantified Self` |
| 💰 Bills & Taxes | `Bills`, `Finance`, `Mortgage`, `Credit Cards`, `SAT`, `Purchases` |
| 📋 Errands | `Challenger`, `Ford Focus`, `Home`, `Misc` |

Leave `Week`, `Habits` and `Inbox` at the top level.

**Why renaming is off the table**: nesting preserves a project's `project_id`, so every
historical `Completions` row keeps resolving correctly. A rename would fork `project_name`
mid-history — old rows saying one thing, new rows another — for no gain.

**Then run one check.** The In Review pipeline still queries by name
(`todoist-sync-sections.gs:39–41`, `#Ascensus | #Work`), and Todoist's `#` matching may now see
both `Work` and `💼 Work`. Open Todoist, run the filter `#Ascensus | #Work`, and confirm it
returns the same tasks as before. If the parent leaks in, tell me — step 3.9 moves that pipeline
to ids too.

## 1.3 — Create the four labels

`area-work` · `area-bills-taxes` · `area-errands` · `area-habits`

The `area-` prefix is load-bearing. You already have `work`, `bills`, `finance` and `taxes` as
topic labels meaning something different — `work` appears on Week cards that are not work-area
tasks. Matching is exact-token, so `work` can never satisfy `area-work`.

## 1.4 — Tag the `Week` backlog *(the real work — 22 cards)*

`Week` is the only project whose contents genuinely span areas, so it is the only place tagging
is mandatory. Every other project inherits its default from the map.

| # | Card | Current labels | Add |
| --- | --- | --- | --- |
| 1 | Work out how much money you currently have | budget, finance | `area-bills-taxes` |
| 2 | Study for the Platform Developer II certification | carrer development, platform-developer-II, salesforce | `area-work` |
| 3 | Go and check on the Challenger's progress | challenger | `area-errands` |
| 4 | Learn how to make a salad | health | `area-errands` |
| 5 | Gather all your tools | home | `area-errands` |
| 6 | Organize your belongings into boxes… | home | `area-errands` |
| 7 | Take anything you no longer need into town | home | `area-errands` |
| 8 | Throw away anything that is not worth keeping | home | `area-errands` |
| 9 | Make a video about the keyboard layout… | tecla | `area-work` **?** |
| 10 | Return the Concentrix and Salesforce laptop | concentrix, salesforce, work | `area-work` |
| 11 | Check Ford Focus taxes | finance, ford-focus, taxes | `area-bills-taxes` |
| 12 | Purchase your license plate adapter for the Dodge Challenger | challenger, purchases | `area-errands` |
| 13 | Start tracking how much money you waste… | budget, finance | `area-bills-taxes` |
| 14 | Return the new shirt you didn't like | purchases | `area-errands` |
| 15 | Contact UVM to check your status | uvm | `area-work` |
| 16 | Listen to the UVM audio that sent to you | uvm | `area-work` |
| 17 | Make sure you know how much money you spend… | budget, finance | `area-bills-taxes` |
| 18 | Fix the scripts that fill your task tracking | quantified-self | `area-work` |
| 19 | Improve your dashboard | quantified-self | `area-work` |
| 20 | Create the data visualization for your gym progress | health, quantified-self | `area-work` |
| 21 | Get a new phone number for work and bill purposes | bills, work | `area-bills-taxes` **?** |
| 22 | Schedule physical reposition of your driver's license | important-documents | `area-errands` |

**Resulting split**: 8 work · 5 bills-taxes · 9 errands.

**Two calls worth making yourself**, marked **?** above:

- **#9, the keyboard-layout video** (`tecla`). Filed as work because it is creative output, but
  if `tecla` is a hobby rather than a professional side project, `area-errands` is truer.
- **#21, the phone number** — it is literally *"for work and bill purposes"*. Filed as
  bills-taxes because the obligation is a bill. If you think of it as a work errand, switch it.

Neither changes any mechanism; both change which bar it lands in.

## 1.5 — Tag the strays

One card sits in `Inbox`: *"Inestigate if the coffe offers internet"* (no labels) →
`area-errands`, or file it into a project and let the default apply.

Everywhere else, add an `area-*` label **only** where a task contradicts its project's default —
a personal errand parked in `Work`, a work task in `Home`. There is no need to label the other
~150 tasks; the map covers them. After Phase 3.1, `diagnoseAreas()` will list anything that
still resolves to `uncategorized`.

## 1.6 — What the nesting buys you

Once the tree exists, the area of a task is derived from its project's **parent**, so a project
you create later under `💰 Bills & Taxes` is a bill from the moment it exists — no code edit, no
map entry, nothing to forget. That is the whole point of doing the reorg.

Three things stay hand-maintained, and they are the exceptions by design: `Week`, `Habits` and
`Inbox` sit outside the tree and resolve by explicit override, and any individual task that
contradicts its project gets an `area-*` label.

`diagnoseAreas()` (step 3.1) reports any project whose parent it cannot resolve, so a project
accidentally left at the top level surfaces rather than silently becoming `uncategorized`.

### Phase 1 exit criteria

- The three parent projects exist, emoji-prefixed, and **no project is named `Habits` twice**.
- All 16 child projects sit under a parent; `Week`, `Habits` and `Inbox` remain top-level.
- No existing project was renamed.
- The filter `#Ascensus | #Work` still returns what it did before the reorg.
- The four labels exist.
- All 22 `Week` cards carry exactly one `area-*` label.
- The `Inbox` card is filed or labelled.

---

# Phase 2 — Prepare the spreadsheet

**You, in Google Sheets**, in `quantified-self-todoist`. Do this **before** Phase 3 runs.

## 2.0 — Duplicate the spreadsheet first

**File → Make a copy.** This is the one genuinely irreversible step in the plan: `Completions`
is the durable completion store, its history predates the 90-day API window, and Phase 3 will
run a repair that rewrites cells in place. A copy costs ten seconds.

## 2.1 — Widen `Completions` *(the only tab needing manual work)*

Add three headers in **row 1, columns O, P, Q**, in this exact order, spelled exactly:

```text
O: area
P: area_source
Q: was_overdue
```

Leave the cells below empty — Phase 3 fills them. `Completions` has no header-writing code and
no layout guard, so this is the one tab where the sheet must lead the script.

**Do not reorder or rename columns A–N.** Every existing script reads them positionally.

## 2.2 — The other tabs create themselves

`BillCycle`, `AreaDaily` and `TaskDaily` are created with their headers on first run, the way
`HabitDaily` was. **Do not create them by hand** — a hand-made header that differs by one
character from the script's constant triggers the layout guard.

### Phase 2 exit criteria

- A dated copy of the spreadsheet exists.
- `Completions` row 1 reads `area`, `area_source`, `was_overdue` in O, P, Q.
- No other tab was touched.

---

# Phase 3 — Implement the scripts

**Me, in this repo.** Ordered so that the Bills report (4a) is unblocked as early as possible.
Each step is independently deployable and independently verifiable.

| Step | What | Unblocks |
| --- | --- | --- |
| 3.1 | `todoist-areas.gs` — parent→area map, `getProjectTree()`, pure `areaOf()`, `inWeekOf()`, `diagnoseAreas()` | everything |
| 3.2 | `area-contract.md` — the authoring rules, incl. the bill definition and the `deadline` fossil | — |
| 3.3 | `Completions`: row mapper writes `area`, `area_source`, `was_overdue` | 3.4, 3.5 |
| 3.4 | `backfillCompletionAreas()` — fill existing rows from `project_id`; no API calls | 4a, 4d |
| 3.5 | `backfillCompletions()` — extend history to ≈ 2026-02 in ≤90-day windows | 4a, 4d |
| 3.6 | `repairCompletionDueDates()` — fix pre-2026-08-10 cycle attribution **in place** | 4a |
| 3.7 | `BillCycle` tab + `schema/bill-cycle.md` + `backfillBillCycle()` | **4a** |
| 3.8 | `AreaDaily` tab + `schema/area-daily.md` | 4b, 4d |
| 3.9 | `TaskDaily` tab + `schema/task-daily.md` — card × day, area-aware | **4b, 4c** |
| 3.10 | Triggers: register the new steps, add the morning bill-risk check | — |
| 3.11 | Docs sweep — counts, module map, `history.md` seams | — |

### Notes on the load-bearing steps

**3.1** — resolution order is **label → project override → project's parent → `uncategorized`**.
`areaOf()` stays pure and is the single source of truth every tab reads; multiple area labels
resolve in a fixed order, never the task's own label order, which Todoist does not guarantee.
Reuses `splitLabels()` / `hasLabel()` (`todoist-habit-daily.gs:677`, `:684`).

This step also **widens the project cache**. `getProjectMap()` returns id→name only, with no
`parent_id`, so deriving area from the tree needs a sibling `getProjectTree()` returning
id → `{name, parentId}`, cached alongside it. The existing `getProjectMap()` keeps its shape so
no current caller changes — `cachedIdNameMap()` gains a companion rather than a rewrite.

Only three ids are hardcoded after this: `Week`, `Habits` and `Inbox`, the projects that sit
outside the tree on purpose. Everything else resolves through its parent.

**3.6** — the only step that updates existing rows. Rows written before 2026-08-10 carry
next-occurrence `due_date` semantics (see `history.md`), which would mis-attribute every bill
cycle before that date by exactly one cycle. Dedup means step 3.5 cannot fix them — a re-fetch
of an already-present completion is dropped, not rewritten.

**3.7** — `BillCycle` is `HabitDaily`'s twin: spine plus truth, scored on a **cycle** rather
than a day. Columns: `bill`, `task_id`, `area`, `project_name`, `cycle` (`YYYY-MM`),
`cycle_due_date`, `closed_at`, `days_late` (negative = early), `status`
(`paid`/`late`/`open`/`overdue`), `was_overdue`, `is_recurring`, `on_time_streak`. Dedup key
`task_id|cycle_due_date`. Reuses `nextStreak()` (`todoist-habit-daily.gs:796`).

> **Documented gap, not solved**: a cycle that was never closed leaves no completion event, so
> skipped cycles stay invisible unless reconstructed by walking the recurrence. Recorded in the
> schema doc as a deliberate undercount, per the house rule.

**3.9** — `TaskDaily` replaces the abandoned `BoardDaily`/`WorkDaily` split. One card × day
tab covering **every open task**, area-aware from birth rather than board-shaped and retrofitted.
Errands need card-level aging just as much as work does, and most errand projects have no
sections at all, so a board-shaped tab was the wrong container.

Columns: `snapshot_date`, `task_id`, `content`, `project_name`, `area`, `area_source`,
`in_week`, `section_name` (blank where a project has none), `work_stage`, `labels`, `priority`,
`due_date`, `deadline_date`, `is_recurring`, `is_subtask`, `added_on`, `days_in_project`,
`section_entered_on`, `days_in_section`, `section_age_seeded`, `days_overdue`, `is_exit`.

**Four mechanisms carry over from the deleted board design** — they were correct, and
re-deriving them would be waste:

1. **Four-case section seeding.** Prior row same section → carry; prior row different section →
   observed move, exact; no prior row in a birth section (`Backlog`) → seed at `added_on`; no
   prior row elsewhere → seed at today, a floor. `section_age_seeded` marks the seeded ones and
   is carried for the whole run, so a floor is never averaged in as an observation.
2. **Exit rows.** One terminal row per task that was present yesterday and is gone today,
   carrying its last observed section. The prior-state read must exclude `is_exit` rows, or a
   departed task emits a fresh exit row every night forever.
3. **Strictly-before prior state.** Read the last snapshot day *before* today, never today's
   own half-written rows, or a same-day re-run resets every age to zero.
4. **Archive, never clear, on an incompatible layout change.** This tab is observed, not
   derived; its history cannot be re-fetched.

`work_stage` normalises the incompatible section vocabularies —
`backlog`/`active`/`review`/`done`/`blocked`/`canceled`, with `Quiz` folding into `review`, an
explicit `other` branch as the rename tripwire, and blank where a project has no sections.

> **Size check.** ~200 open tasks × 22 columns × 365 days ≈ 1.6M cells a year, against a
> 10M-cell limit shared by every tab in the spreadsheet. Fine for two to three years, then it
> is not. Decide the retention rule when building it — a rolling window, or its own
> spreadsheet — rather than discovering the ceiling later.

### Phase 3 exit criteria

- `diagnoseAreas()` reports `uncategorized = 0` and no unmapped project id.
- Earliest `Completions` row ≈ 2026-02; no blank `area`; re-running 3.5 adds zero rows.
- `BillCycle` reproduces the research numbers — see Verification 6.
- `TaskDaily` created with its full header; a second same-day run leaves the row count unchanged.
- Full `syncTodoist()` logs success on every step, `HabitDaily` still last.

---

# Phase 4 — Build the reports

**You, in Looker Studio.** Each sub-phase gets its own recipe doc written during Phase 3,
precise enough to follow click-by-click and to rebuild from if the page is ever lost — the
format `analytics/habits-page.md` already uses.

Every recipe carries forward the same conventions: the state-vs-event date-range warning,
numeric-prefixed labels so Looker's alphabetical sort does not scramble an ordered dimension,
and the `ISOWEEK` workaround.

**Palette**: the four areas take categorical slots 1–4, already assigned to habit
`section_name`s. Acceptable because the two never appear in one chart — the standing rule is
that a chart is coloured by section *or* status, never both — but the cross-page ambiguity gets
written into both palette docs.

## 4a — Bills report *(build first)*

Source: `QS - BillCycle`. Recipe: `analytics/bills-page.md`.

Bills come first because the consequences are real (late fees, credit standing), the data is
already complete back to February, and the current state is bad enough to act on immediately.

| Section | Answers |
| --- | --- |
| **Due next** | What is coming, ordered by days-until-due — **never by priority**, since every bill is p1 |
| **Overdue now** | What has already slipped, with days overdue. `Pay predial` should appear at 31+ days |
| **On-time rate** | Per bill and overall, from `was_overdue` — the honest cycle-closed-late measure |
| **Days-late distribution** | Which bills are chronically late, and by how much. Electricity and internet will stand out |
| **Cycle history** | Bill × month heatmap of `status`, so a run of late months is visible at a glance |

Excluded on purpose: `deadline_date` (the fossil) and `priority` (no signal).

## 4b — Errands report

Source: `QS - AreaDaily` filtered to `errands`, plus `QS - TaskDaily` for card detail.
Recipe: `analytics/errands-page.md`.

**Errands need a different shape from bills.** A bill has a cycle and a deadline; an errand is a
long tail of small things that quietly rot. The questions are *what has been sitting longest*
and *what could I clear today* — so this report is built on aging and quick wins, not cadence.

| Section | Answers |
| --- | --- |
| **Open now** | Total errands, and how many are overdue |
| **Aging** | Oldest errands by `days_in_project`, so the six-month-old ones surface |
| **Quick wins** | Undated, unblocked errands — the "pick one and finish it" list |
| **In this week** | Which errands you actually pulled into `Week`, and whether they moved |
| **Trend** | Errand count over time: is the tail growing or shrinking? |

## 4c — Work report

Source: `QS - TaskDaily` filtered to `work`. Recipe: `analytics/work-page.md`. Flow, WIP, aging
and throughput across `Work`, `Ascensus`, `Study/Reading` and `Concentrix`, on `work_stage`.

## 4d — Areas overview

Source: `QS - AreaDaily`. Recipe: `analytics/areas-page.md`. The "am I lost?" page — per-area
scorecards, an area × week completion heatmap, the `uncategorized` count as its own metric, and
in-week alignment: is my week aimed where I said it was?

---

## Files

**Create**: `sheets/todoist/todoist-areas.gs` · `todoist-bill-cycle.gs` ·
`todoist-area-daily.gs` · `todoist-task-daily.gs` · `sheets/todoist/area-contract.md` ·
`schema/bill-cycle.md` · `schema/area-daily.md` · `schema/task-daily.md` ·
`analytics/bills-page.md` · `analytics/errands-page.md` · `analytics/work-page.md` ·
`analytics/areas-page.md`

**Modify**: `todoist-sync.gs` · `todoist-sync-completions.gs` · `schema/completions.md` ·
`history.md` · `sheets/todoist/README.md` ·
`sheets/README.md` · `docs/todoist/architecture.md` · `analytics/README.md` · both palette docs ·
root `README.md`

**Reuse**: `todoistGetPaged`, `getProjectMap`, `splitLabels`, `hasLabel`, `dateKey`,
`localDateString`, `localDayOf`, `nextStreak`, and `replaceHabitDailyRows`'s clear-then-append
idiom.

**Re-add**: `daysBetweenDays(fromDay, toDay)` in `todoist-sync-utils.gs` — whole days between
two calendar days, both ends anchored to UTC midnight so a span crossing a DST change stays
exact, inputs sliced to 10 chars so a floating due datetime works. It existed for the deleted
board tab and was removed with it rather than left as an unused global; step 3.7 needs it.

### Interaction with `typescript-port.md`

Untracked, nothing implemented, touches every file this plan touches. It declares the
`schema/*.md` column tables to be the port's **specification** and proposes a test asserting
they match the `*_HEADER` constants — so every column added here must land in both. Its Part 1
(clasp) is worth doing before step 3.9 but is not a blocker. **Do not start the port mid-phase.**

## Verification

1. `node --check` on every touched `.gs`. `npm run format` on **new files only** — the committed
   `.gs` predate the current `tabWidth: 8` config, so a repo-wide run rewrites ~150 untouched
   lines. `npm test` is a stub that always exits 1.
2. Scratchpad harness per the `hd-harness.js` / `bd-harness.js` precedent: `areaOf()` across all
   four resolution paths; **a bare `work` label must not satisfy `area-work`**; multi-label
   resolution order; bill-cycle derivation (`cycle_due_date` → `cycle`, `days_late` sign);
   `on_time_streak` resetting on a late cycle.
3. **After Phase 1**: the filter `#Ascensus | #Work` returns what it did before the reorg (the
   In Review pipeline still queries by name); exactly one project is named `Habits`; and once
   3.1 ships, `diagnoseAreas()` reports `uncategorized = 0`, zero unlabelled `Week` cards, and
   no project whose parent it cannot resolve.
4. **After Phase 2**: `Completions` row 1 reads `area`, `area_source`, `was_overdue` in O–Q.
5. **After 3.5**: earliest `Completions` row ≈ 2026-02; a re-run adds zero rows.
6. **After 3.7 — check against the research numbers.** Electricity 2026-08 late by 12 days,
   internet 2026-08 by 24, Telcel 2026-08 by 10, building maintenance 2026-08 closed early,
   `Pay predial` open and 31+ days overdue. If these do not reproduce, cycle attribution is
   wrong — stop before building 4a.
7. **Cross-check a backfilled week** against Todoist's own completed-task list for the same
   window; per-area counts must match.
8. **After 3.9**: a second same-day run of `syncTaskDaily()` leaves the row count unchanged and
   every `section_entered_on` identical — proof the prior-state read is strictly-before.
9. Full `syncTodoist()`: every step logs success, `HabitDaily` still runs last.
10. Each report: walk its own recipe's verification list.

## Rejected

- **A flat, hand-maintained project→area map.** Was the original design and is simpler to build,
  but every new project silently falls to `uncategorized` until someone edits the map. The parent
  tree makes categorization automatic, which is worth one widening of the project cache.
- **Renaming projects to avoid emoji prefixes**, e.g. `Work` → `Day Job` under a `Work` parent.
  Renames fork `project_name` mid-history for no benefit; the emoji costs nothing and `project_id`
  is what the pipeline actually keys on.
- **A `Habits` parent project, for symmetry.** `getHabitsProjectId()` matches by exact name and
  takes the first hit, so a second `Habits` would silently break `rescheduleAllHabits()`. One
  child needs no parent.
- **Deriving area from a Looker `CASE` on `project_name`.** Instantly retroactive and zero code,
  but duplicates a 19-project mapping into every data source, breaks on rename, and cannot
  express a label override.
- **Reusing the existing `bills` / `work` / `finance` labels.** Topic tags already in use with a
  different meaning — `work` appears on Week cards that are not work-area tasks.
- **An exclusion list instead of `uncategorized`.** Inverting the default makes every new project
  silently count as something. `habits-contract.md` already settled this.
- **Renaming `Study/Reading` to dodge the `/` filter bug.** The id-based fetch removes the need,
  and a rename would break `project_name` continuity across historical rows.
- **Tracking bill amounts now.** No bill carries one; adding them means re-authoring every
  recurring task before anything works. Deferred, not refused.
- **Scoring bills on `completed_at`.** The 2026-09-08 sweep closed three cycles in three seconds.
- **Extending the categorical palette beyond four slots.** Capped in both palette docs with
  measured CVD reasoning. Four areas fit exactly.
