# Life areas and bill cycles — design

**Status** (2026-09-08): **Phases 1–3 complete. Nothing is deployed.**

Todoist is categorized (three parent projects, 16 nested children, four `area-*` labels, 135
tagged tasks) and all eleven Phase 3 steps are written and tested — four new `.gs` files, three
new tabs, three schema docs, 114 harness assertions passing. **None of it has been pasted into
Apps Script yet**, so no sheet column or tab exists in the live spreadsheet, and no Looker page
has been built. See [Deploying](#deploying) for the order, which matters: two steps rewrite
data.

The work is organised into **four phases by where you do it** — Todoist, then Google Sheets,
then the repo, then Looker Studio. Each phase is one tool and one sitting; you never have to
ping-pong between them. Phase 3 is mine; Phases 2 and 4 are yours. Phase 1 was written to be
followed click-by-click but ended up executed through the Todoist API instead — the record of
what was done is kept below either way, because it is what the area map encodes.

**Phases 1 → 2 → 3 must run in that order** — with one correction made while implementing 3.3.
Tagging still feeds the area map, so 1 precedes 3. But the stated danger in Phase 2 was wrong:
a widened row array does **not** land misaligned. `syncCompletions()` writes with
`getRange(lastRow + 1, 1, n, rows[0].length).setValues(rows)` — it starts at column 1 and takes
its width from the array, so the three new values land in O–Q correctly whether or not headers
exist. The real consequence of skipping Phase 2 was narrower: the columns would sit under blank
headers and no by-name reader would find them. Step 3.3 now names them itself
(`ensureCompletionsAreaColumns()`), which makes **2.1 a no-op safety net rather than a
prerequisite** — though 2.0, the backup, is not optional, because 3.6 rewrites cells in place.
Phase 4 sub-phases can be built in any order once Phase 3 is deployed.

## Phase status

| Phase | What | Who / where | State |
| --- | --- | --- | --- |
| **1** | Categorize tasks with area labels | Done via the Todoist API | **done 2026-09-08** |
| **2** | Prepare the spreadsheet tabs | You — Google Sheets | **mostly superseded by 3.3.** 2.1 is now automatic; **2.0, the backup, is still required** before deploying |
| **3** | Implement the scripts | Me — this repo | **written and tested 2026-09-08. Not deployed** — see [Deploying](#deploying) |
| **4a** | Bills report | Recipe: me · Build: you | not started — **build this one first** |
| **4b** | Errands report | Recipe: me · Build: you | not started |
| **4c** | Work report | Recipe: me · Build: you | not started |
| **4d** | Areas overview | Recipe: me · Build: you | not started |

Phase 4 is two jobs, not one: each page needs a **recipe doc** written here (mine, none exist
yet) and then **built in Looker** (yours). Phase 4 cannot start until Phase 3 is deployed —
three of its four sources are tabs that do not exist in the spreadsheet yet.

Update this table as phases complete, with the date. `diagnoseAreas()` now exists: run it from
the Apps Script editor as the first thing in any session and **believe its output over this
document**. It writes nothing.

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
history, gives **Bills** a cycle-aware tab of its own, and gives **Work** its own page — on the
shared `TaskDaily` tab, not a tab of its own. That last part changed during design: errands need
exactly the same card-level aging, so one area-aware tab serves both.

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
| The activity payload already carries **`wasOverdue`** and **`completedDueDate`** | Worth capturing — but it is `completed_at` vs due date computed by Todoist, **not independent evidence**. Better precision, same measurement |
| Every recurring bill is **`p1`** | Priority carries no ranking signal inside bills. Days-until-due is the only ordering |
| **`deadline` is a fossil** — Telcel's reads `2026-07-01` while its due date is `2026-09-29`; Todoist never advances a deadline on recurrence | Exclude `deadline_date` from bill urgency entirely |
| `Pay predial` is non-recurring, due `2026-08-08` — **31 days overdue** | One-off obligations must reach the bills report too |
| **`PAY THE MORTGAGE` is due `every 2nd at 2:00 am`** — all five cycles carry `wasOverdue: true`, at 1 / 1 / 2 / 5 / 28 days | A small-hours due time makes on-time closure impossible: the task is overdue from 02:00 that day, so every waking-hour check-off is late by construction. **Audit due times before reading chronic lateness as behaviour.** Found 2026-09-08 from the first live `BillCycle` output |
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
| Area of a task | **Label → project override → nearest mapped ancestor → `uncategorized`** | Most projects map cleanly; `Week` genuinely mixes. The label is the escape hatch. Four branches, not three — the ancestor walk is what makes new projects self-categorizing |
| **Label coverage** | **Every task in the 16 child projects carries an `area-*` label. `Habits` carries none** | Chosen 2026-09-08, replacing label-only-on-`Week`. Inheritance was invisible in Todoist itself — you could not see your own categorization without running a script. `Habits` is excluded because its existing `habits` / `sub-habits` labels already say the same thing, and 71 rows of redundancy buys nothing |
| `area-habits` | **Created, deliberately unused** | The `Habits` project resolves by project override, so no task needs the label. It stays as the escape hatch for a habit-area task living outside `Habits`. An unused label is the correct state, not an oversight |
| Never guess | An unmapped project yields `uncategorized` | A visible undercount beats invisible inflation — the bargain `habits-contract.md` already strikes |
| Honesty marker | `area_source`: `label` / `project` / `parent` / `default` | Separates "you told me" from "I derived it", so a derived value can be excluded from a chart rather than silently averaged in as declared. **Four values as built**: merging `project` (an explicit override) with `parent` (derived from the tree) would erase the distinction the column exists for |
| Map keyed by | **`project_id`**, names in trailing comments | A rename would otherwise silently re-home every task |
| `Week` | Default `errands`, **plus an orthogonal `in_week` flag** | `Week` is a focus view, not a category. `in_week` stops a prioritised bill booking itself as an errand |
| Label naming | `area-work`, `area-bills-taxes`, `area-errands`, `area-habits` | The bare `work`, `bills`, `finance`, `taxes` labels exist meaning something else. Exact-token matching, so `work` never satisfies `area-work` |
| **Subprojects** | **Yes** — three new parent projects; area derived from `parent_id` | Makes the map self-maintaining: a project created under a parent is categorized automatically, with no code edit. Costs a **companion** to `getProjectMap()` — `getProjectTree()` returning id → `{name, parentId}` — rather than widening it, so no existing caller changes |
| Parent naming | **Emoji-prefixed**, and **no parent named `Habits`** | `getHabitsProjectId()` (`todoist-reschedule-habits.gs:198–204`) matches by exact name, first hit wins — a second `Habits` would silently break the habit reschedule. Distinct names also keep chart legends unambiguous |
| Existing projects | **Never renamed**, only moved | Nesting preserves `project_id`, so all history survives. A *rename* would fork `project_name` mid-history and create a seam for no benefit |
| **What is a bill** | A task whose area is `bills-taxes`. Recurring → one row per cycle; one-off → a single cycle row | The area label already marks it; no extra label needed |
| **Bill grain** | **Cycle**, not day | `HabitDaily`'s daily rule would score a monthly bill `missed` 30 days out of 31 |
| **On-time rule** | **Closure, not payment.** `closed` / `closed_late` from `wasOverdue`, falling back to dates | Revised 2026-09-08 after the first live run. Todoist only knows when the box was ticked, so the columns are named for closure and make no payment claim. `wasOverdue` is **not** a second source — it *is* `completed_at` vs the due date, computed by Todoist at timestamp precision |
| Amounts | **Not tracked** | No bill carries one today. A later, separate decision |
| Work | Own report, on the shared `TaskDaily` tab | Work is the spine and deserves its own page. A *separate tab* proved wrong: errands need the same card-level aging, so one area-aware tab serves both |

### The target project tree

Three new parent projects; **16 of the existing 19 move underneath**, unrenamed. `Week`,
`Habits` and `Inbox` stay top-level and resolve by explicit override.

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

> **Done 2026-09-08**, executed through the Todoist API rather than by hand. Everything below
> is kept as the record of what was done and why — the resulting structure is what
> `todoist-areas.gs` encodes, so changing Todoist without changing the map breaks the mapping.
>
> Reversibility, accurately stated: the **labels** are additive and trivially reversible, but
> 1.2 **moved 16 projects** under new parents. That preserves every `project_id`, so no history
> was harmed, but it is a structural change, not just tagging.

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

**The check was run, and the answer is no leak.** The In Review pipeline still queries by name
(`todoist-sync-sections.gs:39–41`, `#Ascensus | #Work`), and the worry was that Todoist's `#`
matching might now also see `💼 Work`. It does not: `##Work`, which explicitly *includes*
sub-projects, returns the same 9 tasks as `#Work`. Had `#Work` bound to the parent, `##Work`
would have pulled in `Study/Reading`, `Math` and `Quantified Self`.

> **Correction to the original plan**: it said step 3.9 would move that pipeline to ids as well.
> It did not — 3.9 became `TaskDaily`, and `todoist-sync-sections.gs` is **unchanged**. It stays
> name-based because the emoji prefix was verified to make that safe. It is still the one
> remaining name-based lookup in the project, so it is listed under
> [Known gaps](#known-gaps-and-open-items).

## 1.3 — Create the four labels

`area-work` · `area-bills-taxes` · `area-errands` · `area-habits`

The `area-` prefix is load-bearing. You already have `work`, `bills`, `finance` and `taxes` as
topic labels meaning something different — `work` appears on Week cards that are not work-area
tasks. Matching is exact-token, so `work` can never satisfy `area-work`.

## 1.4 — Tag the `Week` backlog *(the real work — 22 cards)*

`Week` is the only project whose contents genuinely span areas, so it is the only place tagging
is **mandatory**. It was done first, before the coverage decision below changed the rest.

> **Superseded in scope by 1.5.** At the time, every other project was to inherit its default
> from the tree and carry no label. That was reversed the same day: everything outside `Habits`
> is now labelled explicitly. `Week` remains the only project where a label is *load-bearing*
> rather than a convenience, because its default is genuinely wrong for half its cards.

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

## 1.5 — Tag every task in the child projects

Done 2026-09-08 — **112 tasks** labelled across the 16 child projects, on top of the 23 from
1.4. Existing labels were preserved on every one; `area-*` was added, never substituted.

| Area | Tasks | Spread across |
| --- | --- | --- |
| `area-work` | 69 | Study/Reading 53, Work 9, Concentrix 3, Math 3, Quantified Self 1, Ascensus 0 |
| `area-bills-taxes` | 15 | Credit Cards 6, Bills 5, Mortgage 2, SAT 2, Finance 0, Purchases 0 |
| `area-errands` | 28 | Home 23, Challenger 3, Ford Focus 1, Misc 1 |

The `Inbox` card *"Inestigate if the coffe offers internet"* took `area-errands` in 1.4.

**`Habits` was left alone** — all 71 of its tasks. Its `habits` / `sub-habits` labels already
carry that meaning, and the project override in step 3.1 resolves the area without help.

**This does not retire the parent tree.** Labelling is a snapshot of today's ~135 open tasks;
every task created tomorrow arrives unlabelled. The tree is what catches those, which is why
`areaOf()` must still fall through to `parent_id` rather than treating a missing label as
`uncategorized`. Labels are now the dense layer, the tree is the safety net — not the reverse.

## 1.6 — What the nesting buys you

Once the tree exists, the area of a task is derived from its project's **parent**, so a project
you create later under `💰 Bills & Taxes` is a bill from the moment it exists — no code edit, no
map entry, nothing to forget. That is the whole point of doing the reorg.

Three things stay hand-maintained, and they are the exceptions by design: `Week`, `Habits` and
`Inbox` sit outside the tree and resolve by explicit override, and any individual task that
contradicts its project gets an `area-*` label.

This matters more now that 1.5 has labelled everything: those labels age. A task moved between
projects keeps the label it was given, so where label and parent disagree, the label wins by
design — which is right for a deliberate override and wrong for a stale one. `diagnoseAreas()`
should report label/parent disagreements so a stale tag is visible rather than silently
authoritative.

`diagnoseAreas()` (step 3.1) reports any project whose parent it cannot resolve, so a project
accidentally left at the top level surfaces rather than silently becoming `uncategorized`.

### Phase 1 exit criteria — all met 2026-09-08

- [x] The three parent projects exist, emoji-prefixed, and **exactly one project is named `Habits`**.
- [x] All 16 child projects sit under a parent; `Week`, `Habits` and `Inbox` remain top-level.
- [x] No existing project was renamed — 16 moves, 0 renames, every `project_id` preserved.
- [x] The filter `#Ascensus | #Work` returns what it did before the reorg.
- [x] The four labels exist.
- [x] All 22 `Week` cards carry exactly one `area-*` label — **8 work · 5 bills-taxes · 9 errands**,
      the split this plan predicted.
- [x] The `Inbox` card is labelled `area-errands`.
- [x] Every task in the 16 child projects carries an `area-*` label. Verified by the filter
      `!@area-work & !@area-bills-taxes & !@area-errands & !#Habits` returning **0 tasks**.
- [x] `Habits` carries no area label at all — the inverse filter
      `#Habits & (@area-work | @area-bills-taxes | @area-errands | @area-habits)` also returns **0**.

**Final counts**: `area-work` 77 · `area-bills-taxes` 20 · `area-errands` 38 · `area-habits` 0.
135 labelled tasks, 71 Habits tasks deliberately untouched.

**The emoji prefix was verified to work, not assumed.** `#Work` still binds to the `Work`
project alone: `##Work` — which explicitly includes sub-projects — returns the same 9 tasks as
`#Work`. Had `#Work` resolved to `💼 Work`, `##Work` would have pulled in `Study/Reading`, `Math`
and `Quantified Self`. So the In Review pipeline (`todoist-sync-sections.gs:39-41`) needs no
change — and in the end received none. The id-based fetch that earlier drafts assigned to step
3.9 was never built; 3.9 became `TaskDaily` instead. That file remains the project's last
name-based lookup, safe but noted under [Known gaps](#known-gaps-and-open-items).

`Ascensus` returned 0 tasks both by filter and by `project_id` — it is genuinely empty, which
predates this reorg. Any future check of that filter should expect `Work` rows only.

**Keep the three parents empty.** They are containers; the area of a task comes from its
project's parent. A task filed *directly* into `💼 Work` would sit in a project with no parent
entry of its own — `diagnoseAreas()` (step 3.1) must therefore treat a parent project holding
tasks as a reportable condition, not just an unmapped id.

### Project ids for step 3.1

Recorded here because these are the only ids the code hardcodes; every other project resolves
through its `parent_id`, which is the whole point of the tree.

| Role | Project | `project_id` |
| --- | --- | --- |
| Parent → `work` | `💼 Work` | `6hRq7W9rfWC9x8R9` |
| Parent → `bills-taxes` | `💰 Bills & Taxes` | `6hRq7WF8xRQGr3MV` |
| Parent → `errands` | `📋 Errands` | `6hRq7WG9X5ghWhRM` |
| Override → `habits` | `Habits` | `6g24MC65RvRwJ4wX` |
| Override → `errands` + `in_week` | `Week` | `6hCMV4WJ343crQmc` |
| Override → `errands` | `Inbox` | `6fgjwG76Qf3h2787` |

Label ids, should a lookup ever need them: `area-work` `2184970412`, `area-bills-taxes`
`2184970414`, `area-errands` `2184970413`, `area-habits` `2184970415`.

---

# Phase 2 — Prepare the spreadsheet

**You, in Google Sheets**, in `quantified-self-todoist`.

> **No longer a prerequisite.** 2.1 became automatic when 3.3 shipped a layout guard. What is
> left here is **2.0, the backup** — and that one matters more than ever, because 3.6 rewrites
> cells in place.

## 2.0 — Duplicate the spreadsheet first

**File → Make a copy.** This is the one genuinely irreversible step in the plan: `Completions`
is the durable completion store, its history predates the 90-day API window, and Phase 3 will
run a repair that rewrites cells in place. A copy costs ten seconds.

## 2.1 — Widen `Completions` *(now automatic)*

> **No longer manual.** `ensureCompletionsAreaColumns()` (shipped in 3.3) names columns O–Q on
> first run, grows the sheet if it is physically narrower than 17 columns, and **refuses to
> overwrite** if O–Q already hold different values. Doing it by hand first is harmless — the
> guard then finds the names already correct and does nothing.

For reference, the columns it creates:

```text
O: area
P: area_source
Q: was_overdue
```

**Do not reorder or rename columns A–N.** Every existing script reads them positionally.

## 2.2 — The other tabs create themselves

`BillCycle`, `AreaDaily` and `TaskDaily` are created with their headers on first run, the way
`HabitDaily` was. **Do not create them by hand** — a hand-made header that differs by one
character from the script's constant triggers the layout guard.

### Phase 2 exit criteria

- A dated copy of the spreadsheet exists. **This is the part that still matters** — 3.6 will
  rewrite cells in place, and `Completions` history predates the 90-day API window.
- `Completions` row 1 reads `area`, `area_source`, `was_overdue` in O, P, Q — by hand, or left
  to the guard in 3.3.
- No other tab was touched.

---

# Phase 3 — Implement the scripts

**Me, in this repo.** Ordered so that the Bills report (4a) is unblocked as early as possible.
Each step is independently deployable and independently verifiable.

| Step | What | Unblocks |
| --- | --- | --- |
| **3.1 ✅** | `todoist-areas.gs` — parent→area map, `getProjectTree()`, pure `areaOf()`, `inWeekOf()`, `diagnoseAreas()` | everything |
| **3.2 ✅** | `area-contract.md` — the authoring rules, incl. the bill definition and the `deadline` fossil | — |
| **3.3 ✅** | `Completions`: row mapper writes `area`, `area_source`, `was_overdue` + a layout guard | 3.4, 3.5 |
| **3.4 ✅** | `backfillCompletionAreas()` — fill existing rows from `project_id` | 4a, 4d |
| **3.5 ✅** | `backfillCompletions()` — extend history to ≈ 2026-02 in ≤90-day windows | 4a, 4d |
| **3.6 ✅** | `repairCompletionDueDates()` — fix pre-2026-08-10 cycle attribution **in place** | 4a |
| **3.7 ✅** | `BillCycle` tab + `schema/bill-cycle.md` (no separate backfill — see below) | **4a** |
| **3.8 ✅** | `AreaDaily` tab + `schema/area-daily.md` + `backfillAreaDaily()` | 4b, 4d |
| **3.9 ✅** | `TaskDaily` tab + `schema/task-daily.md` — card × day, area-aware | **4b, 4c** |
| **3.10 ✅** | Triggers: register the new steps, add the morning bill-risk check | — |
| **3.11 ✅** | Docs sweep — counts, module map, `history.md` seams | — |

### What 3.1 and 3.2 actually shipped

`sheets/todoist/todoist-areas.gs` and `sheets/todoist/area-contract.md`, both new, no existing
file touched. 36/36 harness assertions pass. **Four deviations from the spec above**, each
deliberate:

1. **`areaOf(projectId, labels, tree)` takes the tree as a third argument.** The spec wrote a
   two-argument function and also called it pure; those cannot both hold once area derives
   from the project tree. Injecting the tree keeps it genuinely pure and testable off
   platform, and lets a caller fetch the tree **once** for a 200-task loop instead of hitting
   the cache 200 times. Callers must pass `getProjectTree()`.
2. **`area_source` has four values, not three:** `label` / `project` / `parent` / `default`.
   The spec listed three, which would have merged "explicit override" with "derived from the
   tree" — exactly the distinction the column exists to preserve. The sheet schema is
   unchanged; only the value set is wider.
3. **The ancestor walk is a loop, not a single parent lookup**, with a depth guard of 10.
   Today's tree is one level deep, so this changes nothing now; it means a future
   sub-sub-project resolves correctly, and a cyclic `parent_id` cannot hang a nightly sync.
   Both cases are covered by the harness.
4. **`diagnoseAreas()` reports four conditions the spec did not name**: parent projects
   holding tasks directly, tasks tagged with two area labels, labels that disagree with the
   tree (the stale-tag detector), and projects no rule can resolve. The last one is the
   valuable addition — it catches a project left at the top level *before* its tasks start
   showing up as `uncategorized`.

`areaLabelsOn(labels)` is a small extra export, used by the diagnostic to spot ambiguity.

> **Wiring status** (superseding the note that stood here while 3.1 was the only step done):
> `todoist-areas.gs` still writes nothing itself, but it is no longer a leaf — `BillCycle`,
> `AreaDaily`, `TaskDaily` and the `Completions` row mapper all call `areaOf()`, and 3.10 added
> the three sync steps to `syncTodoist()`. Pasting the files in therefore **does** change what
> the nightly run does. `diagnoseAreas()` remains read-only and is still the right first thing
> to run.

### What 3.3–3.5 shipped

All in `todoist-sync-completions.gs`; no new file.

- **`completionRow()` was extracted** from the inline mapper and is now shared by the nightly
  sync and the backfill. Two copies of a 17-column layout is precisely how a column drifts out
  of alignment with its schema doc.
- **`ensureCompletionsAreaColumns()`** names O–Q, grows a physically narrow sheet, and throws
  rather than overwriting columns that already hold something else.
- **`was_overdue` is captured** from `extra_data.was_overdue`, which was previously read past
  and discarded. It is written **blank, not `FALSE`, when unknown** — only recurring activity
  events carry it, and "unknown" must never read as "on time" in a bills chart.
- **`backfillCompletionAreas()`** fills blanks only. It never rewrites a row that already has
  an area, so re-running is a no-op and a later re-parenting cannot quietly rewrite history.
  One deviation: it needs the project tree, so it makes one cached `/projects` call rather than
  the zero the spec promised.
- **`backfillCompletions(since)`** loops ≤90-day windows back to `2026-02-01`. It leaves
  `TODOIST_LAST_SYNC` untouched — the nightly cursor must keep meaning "caught up to now" — and
  **skips the In Review source entirely**, because that is a state snapshot rather than history
  and replaying it would invent movement events that never happened. It also dedups *within*
  the run, since adjacent windows share a boundary instant.

13 further harness assertions cover the row shape: width 17, area/source resolution into O–P,
and all four `was_overdue` states including the blank-not-FALSE rule.

### What 3.6–3.11 shipped

Three new files — `todoist-bill-cycle.gs`, `todoist-area-daily.gs`, `todoist-task-daily.gs` —
plus `repairCompletionDueDates()`, `daysBetweenDays()` and `archiveAndRecreateSheet()` in the
shared layer, three schema docs, and the docs sweep. **114 harness assertions pass in total.**

- **3.6** is the only function in the project that rewrites existing cells. It is scoped to
  recurring rows whose `sync_date` predates the fix, matches events by `task_id|day` (falling
  back to an exact timestamp when a task was closed twice in a day), and **leaves unmatched
  rows alone** rather than blanking a date it could not re-verify.
- **3.7** has **no separate backfill entry point**, deviating from the spec. `syncBillCycle()`
  is a full rebuild from `Completions` plus the live list, so the nightly path already reaches
  all of history; a `backfillBillCycle()` would have been a second name for the same call, and
  the global scope is flat.
- **3.10** puts `checkBillRisk()` on its own **morning** trigger rather than inside
  `syncTodoist()`. A 23:30 warning about a bill due that day is useless, and this is the
  trigger that would actually have caught the 24-day-late internet bill.
- **`pruneTaskDaily()` is deliberately manual.** The size ceiling is real (~1.6M cells a year
  against 10M shared across every tab), but silently deleting observations that nothing can
  rebuild is not a job for a nightly trigger. The sync warns as the ceiling approaches.

> **A correction the harness forced.** The first run of the bill harness disagreed with the
> research by exactly one day on three bills. The cause was the *stub*, not the code: it
> formatted dates in UTC, and those bills were checked off at 00:18 UTC = 18:18 the previous
> day locally — reproducing precisely the bug `history.md` records for 2026-08-20. The code
> was right; the plan's expected numbers were UTC-derived. See Verification 6.

### Notes on the load-bearing steps

**3.1** — resolution order is **label → project override → nearest mapped ancestor →
`uncategorized`**. `areaOf()` stays pure and is the single source of truth every tab reads;
multiple area labels resolve in a fixed order (`bills-taxes` → `work` → `habits` → `errands`),
never the task's own label order, which Todoist does not guarantee. Reuses `splitLabels()` /
`hasLabel()` (`todoist-habit-daily.gs:677`, `:684`).

> **What 1.5 changed for this step.** Open tasks now resolve at the *label* branch almost
> universally, so `area_source` reads `label` for ~135 tasks and `project` for the 71 in
> `Habits`. The parent branch will look dead on today's data — it is not. It is what catches
> every task created from now on, and removing it would make each new task `uncategorized`.
> Keep the branch and keep it tested, even though a live run exercises it only via `Habits`.
> Note also that historical `Completions` rows still resolve at the *parent* branch, since their
> `labels` column is frozen at capture — so `area_source` genuinely varies across the sheet, and
> a chart that averages declared and derived rows together is mixing two things.

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
`cycle_due_date`, `closed_at`, `days_to_close` (negative = closed early), `status`
(`closed`/`closed_late`/`open`/`overdue`), `was_overdue`, `is_recurring`,
`on_time_close_streak`. Dedup key `task_id|cycle_due_date`. Reuses `nextStreak()`
(`todoist-habit-daily.gs:796`).

> **Renamed 2026-09-08, after the first live run.** The columns originally read `days_late`,
> `paid`/`late` and `on_time_streak` — all of which assert something about *payment* that
> Todoist cannot support. The tab measures when a task was **ticked**. Renaming was chosen
> over adding a grace window: a threshold would have hidden real slippage behind a number
> nobody could justify, whereas the rename makes every existing row readable as-is.

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

> **Size check — decided.** ~200 open tasks × 22 columns × 365 days ≈ 1.6M cells a year,
> against a 10M-cell limit shared by every tab in the spreadsheet. Fine for two to three years.
> The rule is `pruneTaskDaily(keepDays)`, and it is **manual on purpose**: these rows are
> observations nothing can rebuild, so deleting them is a decision rather than maintenance. The
> sync logs a warning past ~4M cells. `AreaDaily` keeps the daily counts regardless, so pruning
> costs card-level detail, not the trend.

### Phase 3 exit criteria

Split by what can be proven off-platform and what genuinely needs the code deployed. Everything
in the first group is **done**; nothing in the second has been checked, because nothing is
deployed.

**Verified in the repo (2026-09-08)**

- [x] All 11 `.gs` files parse; the four new/edited ones are prettier-clean.
- [x] 114 harness assertions pass — `areaOf()` across all four branches, the exact-token guard,
      multi-label precedence, the 17-column row shape, bill status and streaks against the
      research numbers, and `TaskDaily`'s four mechanisms.
- [x] No new global collides in the flat scope (the only duplicate is the pre-existing
      `toDateString`, documented in `typescript-port.md`).
- [x] Every relative link in every touched doc resolves.

**Needs a live run — none of these have happened yet**

- [x] `diagnoseAreas()` reports `uncategorized = 0` and no unmapped project id.
- [x] Earliest `Completions` row ≈ 2026-02; no blank `area`; re-running 3.5 adds zero rows.
- [x] `BillCycle` reproduces the research numbers — see Verification 6, **and read the timezone
      correction there before calling it a failure**.
- [x] `TaskDaily` created with its full header; a second same-day run leaves the row count
      unchanged and every `section_entered_on` identical.
- [x] Full `syncTodoist()` logs success on all eight steps, `HabitDaily` still last.

---

# Deploying

Order matters — two steps rewrite existing data, and one of them cannot be undone without the
backup.

| # | Do this | Why this position |
| --- | --- | --- |
| 1 | Paste all **ten** `sheets/todoist/*.gs` files into `quantified-self-sync` | Four are new. The flat scope means a missing file is a runtime `ReferenceError`, not a load error |
| 2 | Run `diagnoseAreas()` | Read-only. Confirms the ids in this document still match the account **before** anything writes |
| 3 | **Back up the spreadsheet** (Phase 2.0) | The last moment this is cheap |
| 4 | `backfillCompletionAreas()` | Fills `area`/`area_source` on existing rows. Blanks only, so it is safe to repeat |
| 5 | `backfillCompletions()` | Extends history to ≈ 2026-02. Dedup makes re-runs no-ops |
| 6 | `repairCompletionDueDates()` | **Rewrites cells.** Must come *after* 5, so it repairs everything, and *before* 7 |
| 7 | `syncTodoist()` | Creates `BillCycle`, `AreaDaily`, `TaskDaily` with their headers |
| 8 | `backfillAreaDaily()` | Fills `completed` for past days; snapshot columns stay blank |
| 9 | Add the `checkBillRisk` morning trigger (~08:00) | Separate from the nightly run on purpose |

**Skipping step 6 is the expensive mistake.** Without it every bill cycle before 2026-08-10 is
attributed to the following month, and the Bills report is quietly wrong about exactly the
history you built it to see.

---

# Phase 4 — Build the reports

**You, in Looker Studio.** Each sub-phase gets its own recipe doc, precise enough to follow
click-by-click and to rebuild from if the page is ever lost — the format
`analytics/habits-page.md` already uses.

> **None of the four recipe docs exist yet.** An earlier draft said they would be written during
> Phase 3; they were not, and they are not in the 3.1–3.11 step table either. Writing them is
> the first task of Phase 4, and it is mine — the sections below are the specification for what
> each one must contain, not the recipes themselves.

The three data sources are already registered in
[`../../analytics/README.md`](../../analytics/README.md), together with the **filters that must
be applied before charting** — `counts_observed = TRUE` on `AreaDaily`'s snapshot columns,
`section_age_seeded = FALSE` before averaging section age, and `is_exit = FALSE` for
"what is open now". Skipping those produces charts that look plausible and are wrong.

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
| **On-time close rate** | Per bill and overall. Title it **"cycles closed on time"**, never "bills paid on time" — the tab cannot support the second claim |
| **Close-lag distribution** | Which bills sit longest before being ticked, and by how much. Electricity and internet stand out. Check each bill's due *time* before reading this as behaviour |
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

**Created ✅** — `sheets/todoist/todoist-areas.gs` · `todoist-bill-cycle.gs` ·
`todoist-area-daily.gs` · `todoist-task-daily.gs` · `sheets/todoist/area-contract.md` ·
`schema/bill-cycle.md` · `schema/area-daily.md` · `schema/task-daily.md`

**Still to create** (Phase 4) — `analytics/bills-page.md` · `analytics/errands-page.md` ·
`analytics/work-page.md` · `analytics/areas-page.md`

**Modified ✅** — `todoist-sync.gs` · `todoist-sync-completions.gs` · `todoist-sync-utils.gs` ·
`schema/completions.md` · `history.md` · `sheets/todoist/README.md` · `sheets/README.md` ·
`docs/todoist/architecture.md` · `analytics/README.md` · both palette docs · root `README.md`

**Reused** — `todoistGetPaged`, `getProjectMap`, `splitLabels`, `hasLabel`, `dateKey`,
`localDateString`, `localDayOf`, `nextStreak`, and `replaceHabitDailyRows`'s clear-then-append
idiom.

**Added to the shared layer** — `daysBetweenDays(fromDay, toDay)`, re-added for step 3.7 after
being removed with the deleted board tab: whole days between two calendar days, both ends
anchored to UTC midnight so a span crossing a DST change stays exact, inputs sliced to 10 chars
so a floating due datetime works. Plus `archiveAndRecreateSheet()`, which `AreaDaily` and
`TaskDaily` both need — they are observed, not derived, so an incompatible layout change must
rename the tab rather than clear it.

### Interaction with `typescript-port.md`

Untracked, nothing implemented, touches every file this plan touches. It declares the
`schema/*.md` column tables to be the port's **specification** and proposes a test asserting
they match the `*_HEADER` constants — so every column added here must land in both. Its Part 1
(clasp) is worth doing before step 3.9 but is not a blocker. **Do not start the port mid-phase.**

## Verification

1. `node --check` on every touched `.gs` — note it rejects the `.gs` extension, so copy to a
   `.js` in the scratchpad first. `npm run format` on **new and touched files only**: the
   committed `.gs` predate the current `tabWidth: 8` config, so a repo-wide run rewrites ~150
   untouched lines. In practice this cost 7 reformatted lines in `todoist-sync-completions.gs`
   and 1 in `todoist-sync.gs`, all mechanical.
   `todoist-habit-daily.gs` and `todoist-reschedule-habits.gs` were **not** touched and remain
   unformatted — that is deliberate, not an oversight. `npm test` is a stub that always exits 1.
2. Scratchpad harness per the `hd-harness.js` / `bd-harness.js` precedent: `areaOf()` across all
   four resolution paths; **a bare `work` label must not satisfy `area-work`**; multi-label
   resolution order; bill-cycle derivation (`cycle_due_date` → `cycle`, `days_to_close` sign);
   `on_time_close_streak` resetting on a late close; and a regression built from the five real
   `PAY THE MORTGAGE` cycles, which must all read `closed_late` and must never read `paid`.
3. **After Phase 1**: the filter `#Ascensus | #Work` returns what it did before the reorg (the
   In Review pipeline still queries by name); exactly one project is named `Habits`; and once
   3.1 ships, `diagnoseAreas()` reports `uncategorized = 0`, zero unlabelled `Week` cards, and
   no project whose parent it cannot resolve.
4. **After Phase 2**: `Completions` row 1 reads `area`, `area_source`, `was_overdue` in O–Q.
5. **After 3.5**: earliest `Completions` row ≈ 2026-02; a re-run adds zero rows.
6. **After 3.7 — check against the research numbers, corrected for timezone.** Note the
   status vocabulary is `closed` / `closed_late`, not `paid` / `late`. The research
   figures (12 / 24 / 10 days late) were measured against the **UTC** date 2026-09-08. Those
   three bills were checked off at 00:18 UTC, which is **18:18 on 2026-09-07 in the script's
   timezone** — so counted on the local day, which is what `BillCycle` uses and what every
   other tab uses, they are **11 / 23 / 9**. Expect the local figures; seeing them is the
   check passing, not failing. Building maintenance 2026-08 still reads closed early (−6, a
   midday completion, unaffected), and `Pay predial` open and 31+ days overdue. If these do
   not reproduce, cycle attribution is wrong — stop before building 4a.
7. **Cross-check a backfilled week** against Todoist's own completed-task list for the same
   window; per-area counts must match.
8. **After 3.9**: a second same-day run of `syncTaskDaily()` leaves the row count unchanged and
   every `section_entered_on` identical — proof the prior-state read is strictly-before.
9. Full `syncTodoist()`: every step logs success, `HabitDaily` still runs last.
10. Each report: walk its own recipe's verification list.

## Known gaps and open items

Things that are true, deliberate, and easy to mistake for bugs later.

| Gap | Status | Detail |
| --- | --- | --- |
| **Nothing is deployed** | Open | All of Phase 3 exists only in the repo. See [Deploying](#deploying) |
| **The four Looker recipe docs do not exist** | Open — first task of Phase 4 | `analytics/{bills,errands,work,areas}-page.md`. The Phase 4 sections here are their specification |
| **`todoist-sync-sections.gs` is still name-based** | Accepted, not fixed | It queries `#Ascensus \| #Work`. Verified safe — `##Work` proves `#Work` binds to the child, not `💼 Work`. It breaks only if someone creates a project whose name collides, or renames one of those two |
| **A bill cycle that was never closed is invisible** | Accepted, documented | No completion event exists to key a row on. A deliberate undercount, per the house rule of undercounting rather than fabricating |
| **`TaskDaily` cannot be backfilled at all** | Structural | Todoist keeps no history of what was open on a past day, and `item:updated` carries no `section_id`. Its first run seeds *every* row's section age as a floor |
| **`AreaDaily`'s snapshot columns start empty** | Structural | Only `completed` reaches backwards. `counts_observed` marks which is which |
| **`repairCompletionDueDates()` cannot reach everything** | Structural | Todoist's activity log retains roughly 12 months. Rows older than that keep their pre-fix value and are reported as unmatched rather than blanked |
| **`Ascensus` is empty** | Not a bug | 0 tasks by filter and by `project_id`, predating the reorg. Expect `Work` rows only from that filter |
| **`area-habits` is applied to nothing** | Correct state | `Habits` resolves by project override. The label stays as the escape hatch for a habit-area task living outside `Habits` |
| **Two `.gs` files are not prettier-clean** | Deliberate | `todoist-habit-daily.gs`, `todoist-reschedule-habits.gs`. Formatting them would churn ~150 untouched lines into an unrelated diff |
| **Due *times* distort lateness** | Open — Todoist-side | `PAY THE MORTGAGE` is due at 02:00, so every waking-hour check-off is `closed_late`. Not fixed in code; auditing the other bills' due times is a worthwhile follow-up |
| **The tab cannot measure payment timeliness** | Structural | Todoist records the tick, not the payment. Making it true would mean ticking a bill at the moment you pay it — a behaviour change, not a code change |
| **`sheets/README.md` links to two deleted files** | Pre-existing | `schema.md` and `apps-script.gs`, removed in commit `4ab0446`. Unrelated to this plan; noted so it is not mistaken for collateral damage |

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
