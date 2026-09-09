# The area contract

How a task is **filed in Todoist** so the sync can tell which area of life it belongs to.
Partly a capture-time taxonomy and partly a structural one: where a project *sits* carries
meaning, and a label overrides it when the two disagree.

Companion to [habits-contract.md](habits-contract.md). How areas are then *reported* is
[../../docs/plans/life-areas.md](../../docs/plans/life-areas.md).

---

## The four areas

| Area | Label | Holds |
| --- | --- | --- |
| `work` | `area-work` | Work, Study/Reading, Ascensus, Concentrix, Math, Quantified Self |
| `bills-taxes` | `area-bills-taxes` | Bills, Finance, Mortgage, Credit Cards, SAT, Purchases |
| `errands` | `area-errands` | Challenger, Ford Focus, Home, Misc, `Inbox`, `Week` by default |
| `habits` | `area-habits` | Habits |

There is a fifth value, `uncategorized`, which is **not** an area. It is what the code
returns when nothing matched — a visible undercount, deliberately preferred over the
invisible inflation an exclusion list would produce.

---

## How an area is decided

Four rules, first match wins:

| # | Rule | `area_source` | Means |
| --- | --- | --- | --- |
| 1 | An `area-*` label on the task | `label` | You said so |
| 2 | An explicit project override | `project` | `Week`, `Habits`, `Inbox` |
| 3 | The nearest mapped ancestor project | `parent` | Derived from the tree |
| 4 | Nothing matched | `default` | `uncategorized` |

`area_source` travels with the area everywhere it is written. It exists so a **derived**
value can be excluded from a chart rather than silently averaged in as though it had been
**declared** — the role `section_age_seeded` plays on a snapshot tab.

### The tree is the part that maintains itself

A project created under `💰 Bills & Taxes` is a bill from the moment it exists. No code
edit, no map entry, nothing to forget. **This is the whole reason the projects were
reorganised into parents**, and it is why rule 3 must survive even though today's labelling
means almost every open task resolves at rule 1 instead.

Only three project ids are hardcoded, and they are exactly the three that sit outside the
tree on purpose: `Week`, `Habits` and `Inbox`.

---

## Authoring rules

**Match the token exactly.** You already have `work`, `bills`, `finance` and `taxes` as topic
labels meaning something else entirely — `work` appears on `Week` cards that are not
work-area tasks. Matching is exact-token, so `work` can never satisfy `area-work`. This is
the same guard `habits` / `sub-habits` needs, for the same reason.

**Never name a project `Habits` twice.** `getHabitsProjectId()`
(`todoist-reschedule-habits.gs`) matches by exact name and takes the first hit, so a second
`Habits` project would make `rescheduleAllHabits()` target a project with no sections and
silently do nothing. This is why there is no `Habits` parent, and why the three parents carry
emoji prefixes.

**Keep the parents empty.** They are containers. A task filed directly into `💼 Work` sits in
a project that has no parent of its own, so it resolves only if a label happens to save it.
`diagnoseAreas()` reports this as a tripwire.

**Nest, never rename.** Nesting preserves `project_id`, so every historical `Completions` row
keeps resolving. A rename forks `project_name` mid-history for no gain.

**One area label per task.** A task carrying two is resolved by a fixed precedence —
`bills-taxes` → `work` → `habits` → `errands` — because Todoist does not guarantee label
order and reading the task's own order would make the answer differ between runs. That
precedence is a tiebreak, not a blessing: `diagnoseAreas()` lists every multi-labelled task
so it can be fixed at source.

**A label outlives the move that made it wrong.** Move a task between projects and its label
comes along. Where label and tree disagree the label wins *by design* — right for a
deliberate override, wrong for one left behind. Only you can tell those apart, so
`diagnoseAreas()` reports the disagreement instead of guessing.

---

## The one thing labels cannot do

`Completions` is append-only and its `labels` column is **frozen at capture**. So:

- Area **by project** is fully retroactive — every historical row carries `project_id`, and
  re-deriving costs no API call.
- Area **by label** is **go-forward only**. A row written last March cannot learn about a
  label added today.

Historical rows therefore resolve at rule 3 and carry `area_source = project`, while today's
open tasks resolve at rule 1 and carry `label`. **This asymmetry is expected**, and it is the
reason `area_source` is stored rather than inferred at read time.

---

## What makes a bill

A task whose area is `bills-taxes`. No extra label — the area label already marks it.

| Shape | Becomes |
| --- | --- |
| Recurring | One row per **cycle** |
| One-off | A single cycle row |

One-off obligations must not fall through: `Pay predial` is non-recurring and was 31 days
overdue on 2026-09-08. A recurring-only rule would have hidden it.

### Scoring a bill: use `was_overdue`, never `completed_at`

The check-off date is **not** the payment date, in either direction. On 2026-09-08 at
00:18:32 / :35 / :37 — three seconds apart — Telcel, electricity and internet were all
checked off, closing cycles 10, 12 and 24 days late. The 2026-08-04 sweep closed several
cycles *early*. Batch check-offs make `completed_at` worthless for on-time measurement.

Todoist's own `was_overdue` (with `completed_due_date` naming the cycle) is the honest
signal, and it is already in the activity payload. It measures **did the cycle close late**,
not **did money move late** — a real limitation, stated here so no chart claims otherwise.

### `deadline` is a fossil — never use it for urgency

Todoist does not advance a `deadline` when a task recurs. Telcel's reads `2026-07-01` while
its due date is `2026-09-29`. Any deadline-based risk chart would be wrong. `deadline_date`
is excluded from every bill urgency calculation on purpose.

### Priority carries no signal inside bills

Every recurring bill is `p1`. Order bills by days-until-due; never by priority.

---

## Checking your work

Run `diagnoseAreas()` from the Apps Script editor. It writes nothing, and **its output is
authoritative over any document, including the plan.** It reports open tasks per area, the
`uncategorized` worklist, unlabelled `Week` cards, multi-labelled tasks, stale-looking
labels, projects no rule can resolve, and any parent project holding tasks directly.

Two filters answer the same questions from inside Todoist:

```text
!@area-work & !@area-bills-taxes & !@area-errands & !#Habits
```

Anything unlabelled outside `Habits` — should be empty.

```text
#Habits & (@area-work | @area-bills-taxes | @area-errands | @area-habits)
```

`Habits` is excluded from labelling on purpose; its own `habits` / `sub-habits` labels
already say the same thing. Should also be empty.

---

## Why `area-habits` exists but is used nowhere

The `Habits` project resolves by project override, so no task there needs the label — and
tagging 71 tasks to restate what `habits` already says buys nothing. The label stays as the
escape hatch for a habit-area task living *outside* `Habits`. **An unused label is the
correct state here, not an oversight.**
