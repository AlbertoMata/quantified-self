# Apps Script → TypeScript port — design

**Status** (2026-09-14): **Phases A–D are complete.** Every tab, the reschedule and the webhook all have TypeScript behind them — **344 tests**, all deployed, all writing only `*_port` shadow tabs. The first manual runs found a real upstream failure and closed it — see [the 503 finding](#the-first-real-failure-a-503-and-what-it-cost). **Phase E is next, and it is the risky one**: it starts with a fresh dated backup and ends with the swap.
Both Apps Script projects — the Todoist sync and the event-log webhook — are now deployed by `clasp push` and verified against the remote. **Copy-paste deployment is over**, which was Phase A's whole point. The
`todoist/ts/` workspace is green (`npm run typecheck`, `npm test` 6/6, Node running `.ts` with
no build step). No TypeScript has been deployed yet.

The **step list** is the plan of record — ✅ done, ⏳ in progress, 🔶 needs you. Everything
under [Reference](#reference) and [Findings](#findings) is material the steps link back to;
you should not need to read it top to bottom.

## Next actions

**The first TypeScript is deployed and executed.** `portPing()` ran green in the live editor at
2026-09-14 22:46 local, beside the ten legacy `.gs`, which are all still there. **71 tests**,
none needing a platform. Nothing the port has deployed can write anything.

**Phase D is done.** Everything the legacy implementation does now exists in TypeScript,
deployed beside it, writing nothing the legacy code owns.

**Phase E needs you to start it**, and it is the first phase where a mistake costs data rather
than time:

| Step | What you do |
| --- | --- |
| **E0** ✅ | **Already covered.** The A8 backup was taken 2026-09-13 and the port has written nothing to a real tab since, so it is still an accurate restore point. Retake it only if a long gap opens before E4 |
| **E1** 🔶 | Install `port`-prefixed triggers **offset 15–30 minutes** from the legacy ones ([why](#running-two-implementations-at-once)) |

Before either, it is worth running each pipeline once by hand — dry run first — so the shadow
tabs exist and hold a day of data to look at.

**Worth doing when you have five minutes**, because it starts Phase E's parity data accruing:
run each `…DryRun` first, then the real one.

| Run | Creates |
| --- | --- |
| `portSyncOverdueDryRun` → `portSyncOverdue` | `Overdue_port` |
| `portSyncRecurringStatusDryRun` → `portSyncRecurringStatus` | `RecurringStatus_port` |
| `portSyncKarmaStatsDryRun` → `portSyncKarmaStats` | `KarmaStats_port` |
| `portSyncCompletionsDryRun` → `portSyncCompletions` | `Completions_port` |

**`portSyncCompletions` will fetch a full 90-day window on its first run**, because its shadow
tab is empty — that is the designed behaviour, not a bug, and it is how the tab refills itself.

**Optional, whenever you like:** run `portPingWriteDryRun` in the editor, then `portPingWrite`.
The first logs the row it would append and touches nothing; the second creates a `Ping_port` tab
with one row. It is the first thing the port writes anywhere, deliberately trivial, and the tab
is safe to delete.

One loose end that is not a step: the event-log **Web App deployment** may still serve an older
version. A push changes the code; only a deployment tracking `HEAD` picks it up automatically.
Worth a glance at *Deploy → Manage deployments* — see [A9](#a9-the-event-log-webhook).

| # | Step | What to do | Why it blocks |
| --- | --- | --- | --- |
| 1 | **E1** 🔶 | `port` triggers, offset 15–30 minutes from the legacy ones | Two implementations, one token, no locking anywhere |
| 2 | **E2** | Let both run for several days | Parity needs data from identical input and timing |
| 3 | **E3** | The diff harness comparing `X` against `X_port` | What parity actually means, mechanically |

## How to read this plan

1. **[The step list](#the-step-list)** is what to do, in order. Steps marked 🔶 need you.
2. **[Reference](#reference)** is how the port is designed — decisions, layers, naming, rails.
   Read [One project: what changes](#one-project-what-changes) before writing any port code;
   it is the constraint that shapes Phase B onward.
3. **[Findings](#findings)** is what was learned from the live projects. A fresh session should
   skim it before touching clasp, because it corrected several things earlier revisions of this
   plan asserted wrongly.
4. **`clasp` auth does not travel.** Credentials live in `~/.clasprc.json` on the machine where
   `clasp login` ran. A remote or mobile session can do decisions and doc work, never a push.
5. **Script IDs are not committed** (`.clasp-*.json` is gitignored). To re-find the standalone
   ones:

   ```sh
   TOKEN=$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.clasprc.json')))['tokens']['default']['access_token'])")
   curl -s -H "Authorization: Bearer $TOKEN" \
     "https://www.googleapis.com/drive/v3/files?q=mimeType%3D%27application%2Fvnd.google-apps.script%27%20and%20trashed%3Dfalse&fields=files(id,name)"
   ```

   Bound webhook projects do **not** appear in Drive; their IDs come from the spreadsheet's
   *Extensions → Apps Script → Project Settings*.

## Goals, in priority order

1. **Agnostic architecture.** Every Google-platform global lives behind an interface, so the
   same logic runs on a GitHub runner later. This is the goal the other three serve.
2. **Readable code.** Self-documenting names, even when longer. See [Naming](#naming-rules).
3. **Visible entry points.** One registry, one generated table — no more hunting across 11
   files for what is callable. See [Entry points](#entry-points-one-registry).
4. **Human-readable architecture docs.** A person should be able to read the layers cold and
   know where a change belongs. See [Doc upkeep](#doc-upkeep).

Facts worth keeping in view while reading the steps: there are **3 time-triggers**
(`syncTodoist`, `syncTodoistIntraday`, `checkBillRisk`; `syncEverhour` is retired) and roughly **30 more
functions callable by hand** — backfills, repairs, diagnostics — none of them indexed anywhere.
And the flat scope has already bitten in production: the **live editor defines `localDayOf()`
twice**, in *Todoist Sync Utilities* and *Todoist Sync - Habit Daily Grid*. The repo
deduplicated it; the editor never got the update. `toDateString()` is also defined twice, but
in two *different* projects, so it is duplication rather than collision — an earlier revision
of this plan called it a collision and the A3 pull disproved that. The point stands either way:
a shared global scope makes both possible, and a module system makes neither.

---

## The step list

Six phases. Each step is sized to be reviewed in one sitting, names what lands and what proves
it, and ends at a point where the repo still works. **Steps marked 🔶 need a decision or an
action from you** — that is where to guide me.

| Phase | What it achieves | Touches production? |
| --- | --- | --- |
| **A** — clasp | Deployment stops being copy-paste. No TypeScript | Yes — pushes the legacy `.gs` it already runs |
| **B** — the seam | Seven port interfaces, both adapters, the build, the guards, the layering test | Only the `portPing` smoke tests |
| **C** — the pure core | Dates, keys, habits, areas: the logic with no I/O | No |
| **D** — pipelines | One tab per step, each a vertical slice ending in a working entry point | Writes `*_port` shadow tabs only |
| **E** — cutover | Parallel run, tab-by-tab parity, then the swap | Yes — this is the risky phase |
| **F** — Actions | The scheduled syncs move to GitHub Actions; webhooks never do | Yes, after E |

> 🔒 **Standing rule for Phases B–E: the port never writes a tab the legacy code owns.**
> Development happens **in the production project, against the production spreadsheet** — your
> decision of 2026-09-10, accepting the risk and relying on git for the code. Isolation
> therefore moves from *a separate project and spreadsheet* to **separate tab names and
> separate global names**, inside the one project. The rails are in
> [Safety rails without a second project](#safety-rails-without-a-second-project), and the
> cheap one — a dated backup copy — is step **A8**, done on 2026-09-13.
>
> Git covers the code and nothing else. It does not hold the spreadsheet, and it does not hold
> Script Properties. `TaskDaily` and `AreaDaily` derive their snapshot columns from their own
> previous day, and Todoist keeps no history of what was open on a past date, so rows deleted
> there are gone from everywhere. That is the exposure this arrangement accepts.

### Phase A — clasp, on the code that exists today

No TypeScript yet. This phase ends copy-paste deployment.

| Step | What lands | Proof it's done |
| --- | --- | --- |
| **A1** ✅ | `todoist/ts/` workspace: `package.json`, `tsconfig.json`, `.gitignore`, `README.md`, and `src/config.ts` — the fail-closed settings reader, with tests. Root gains `workspaces`, `typecheck`/`test` delegation, a split `format:gs` / `format:ts`, and a committed lockfile | `npm run typecheck` clean, `npm test` 6/6 green — Node runs `.ts` with no build step, as designed |
| **A2** ✅ | `@google/clasp` (v3.4.1) added, `.clasp.example.json` committed, real `.clasp-*.json` gitignored, `clasp:login` / `clasp:whoami` scripts wired | `clasp:whoami` reports the authorised account |
| **A3** ✅ | `clasp pull` of both standalone projects into the **scratchpad** (never the working tree — pull overwrites), diffed against the repo with formatting normalised | [Findings](#what-the-a3-pull-found): 9/11 files identical, 2 differences, both understood |
| **A4** ✅ | Manifest **captured** to `todoist/ts/appsscript/todoist.json` (the Everhour one was dropped with the integration), and the [three decisions](#a4-the-three-decisions-settled) settled: **both `Fullsteam` and `Ascensus` are gone from Todoist** and out of scope, `localDayOf` ships deduplicated, the manifest stays out of the source tree | All three answered. Decision 1 turned out to need a **real code change** — `TARGET_PROJECTS` is now `["Work"]` |
| **A5** ✅ | [`scripts/prepare-legacy.mjs`](../../todoist/ts/scripts/prepare-legacy.mjs) stages a project's `.gs` set + its manifest into `dist/<project>/`; `stage:*`, `status:*` and `push:*` scripts wired for `sync` and `log`. Legacy stages **unbundled**, one file per `.gs`, so the editor stays diffable file-by-file; bundling starts at B4. **`sync` is pushed and verified**, and `log` followed at [A9](#a9-the-event-log-webhook) — both projects now deploy by push | **Met for both projects.** Each remote was re-read after its push: 11/11 files match `dist/sync/` (and the duplicate `localDayOf` is gone, A4 #2), 2/2 match `dist/log/`, with no stale files left in either. **The re-read is the proof, not the exit code** — `clasp push` exits 0 when it skips |
| **A6** ✅ | **Verify**, not deploy — the four life-areas files were already live (A3). You confirmed on 2026-09-13 that the `BillCycle`, `AreaDaily` and `TaskDaily` tabs exist and `Completions` carries `area` / `area_source` / `was_overdue`. [`life-areas.md`](life-areas.md) has been corrected: its "Nothing is deployed" status and the matching Known-gaps row are resolved | **Met.** The three tabs exist and the area columns are present — so the nightly run has been writing them, not failing silently |
| **A7** ✅ | Setup docs rewritten from paste to `clasp push`, across **five** files rather than the three planned: `CLAUDE.md` (now carries the commands and the three traps, not just a caveat), `README.md`, `docs/sheets.md` (a per-project command table), and the two the plan had missed — `event-log/README.md` and `event-log/shortcuts/README.md`, which still said "delete any existing code and paste" | **Met.** No doc tells you to paste `.gs` into the editor. The remaining "paste" instructions are all legitimate — header rows into a tab, and the Web App URL into a Shortcut |
| **A8** ✅ | **A dated backup copy** of `quantified-self-todoist` — File → Make a copy, named with today's date, then left untouched. No second Apps Script project: the port develops in the production project ([decision](#one-project-what-changes)). This is the only thing standing between a bad `replaceWhere` and unrecoverable `TaskDaily`/`AreaDaily` history | **Met.** A dated copy exists as of 2026-09-13, and nothing writes to it |
| **A9** ✅ | **Unblock `push:log`** — Script ID captured 2026-09-13 into the gitignored `.clasp-log.json`, and the **real manifest** cloned to `todoist/ts/appsscript/log.json`. It was worth refusing to guess: it carries `webapp.executeAs: USER_DEPLOYING` and `webapp.access: ANYONE_ANONYMOUS`, the settings the Shortcuts' URL depends on. Pushed 2026-09-14 ([what the diff found](#a9-the-event-log-webhook)) | **Met.** The remote was re-read after the push: both files match `dist/log/` byte-for-byte, no stale files remain, and the `webapp` block survived intact |
| **A10** ✅ | **[`scripts/verify-push.mjs`](../../todoist/ts/scripts/verify-push.mjs)** — `clasp pull`s the live project into a throwaway directory and diffs it against `dist/<project>/`, reporting `DIFFERS` / `MISSING` / `STALE` per file and exiting 1 on any of them. Wired into both `push:*` scripts, so a push that deploys nothing can no longer report success. It compares names without extensions, because Apps Script stores a type rather than a filename and a staged `.gs` returns from a pull as `.js` | **Met, and all four paths exercised.** Clean: 11/11 `sync`, 2/2 `log`. Then deliberately broken three ways — an edited staged file (`DIFFERS`), a deleted one (`STALE`), an unpushed addition (`MISSING`) — each exiting 1. Restaging returns it to green |

### Phase B — The seam

The interfaces that make everything above them platform-free. No behaviour moves yet.

| Step | What lands | Proof it's done |
| --- | --- | --- |
| **B1** ✅ | `src/ports/` — the interfaces, and **seven rather than six**: the planned `HttpTransport`, `TableStore`, `KeyValueStore`, `CacheStore`, `Clock`, `Logger`, plus **`IdGenerator`** ([why](#b1-what-the-seven-ports-settled)). Also `values.ts` (`CellValue`, `Row`, `TableName`) and a `Runtime` bundle so an entry point stays ~8 lines | **Met, and more than typecheck.** `typecheck` clean and `npm test` 11/11: a fake of every port is built in [`ports.test.ts`](../../todoist/ts/src/ports/ports.test.ts), proving the seam is satisfiable with no platform at all. No implementation ships — the fakes live in the test |
| **B2** ✅ | `src/core/write-plan.ts` — `WriteOperation`, `WritePlan`, `Match` (**with a third case the design lacked**, [why](#b2-what-the-three-verbs-cost)), the pure `resolveWriteOperation` resolver and the builders; `src/core/row.ts` — column lookup by name, short-row reads, width checks; `src/core/apply-write-plan.ts` — the thin applier, with dry-run built in | **Met.** 34 tests green, all three verbs covered against an in-memory table including the empty, first-run, no-rows and duplicate-key cases — plus the refusal that protects `TaskDaily` |
| **B3** ✅ | `src/adapters/gas/` — all seven ports over `SpreadsheetApp`, `UrlFetchApp`, `PropertiesService`, `CacheService`, `Utilities` and `Logger`. (`Session` is **not** used: `getScriptTimeZone()` is deleted by design.) Every adapter takes its API as an argument, so the globals are named in exactly one file, `gas-runtime.ts` | **Met, and beyond it.** 65 tests: a fake per global, plus an end-to-end test applying a real `WritePlan` through the real adapter — which is what actually proves the clear-then-write contract ([findings](#b3-what-the-adapters-proved)) |
| **B4** ✅ | esbuild → **one file**, `dist/sync/port-bundle.gs` (11.3 KB), staged alongside the ten legacy `.gs` because a push replaces the whole project ([why](#one-project-what-changes)). IIFE + a generated footer that **prefixes every entry point with `port`**, both driven by [`registry.ts`](../../todoist/ts/src/entrypoints/registry.ts). The build **runs the bundle in a sandbox before writing it** ([findings](#b4-the-first-typescript-in-production)) | **Fully met.** The live project holds 12 files: all **10 legacy `.gs` still present**, the bundle, and the manifest. The push was purely additive — one NEW file, nothing changed or deleted — and `verify:sync` (A10) ran inside `push:sync` and reported 12/12. **`portPing()` then ran green in the editor**, logging both expected lines and completing without error |
| **B4b** ✅ | **The guards that replace a second project**, in [`core/guards.ts`](../../todoist/ts/src/core/guards.ts) — decorators over any `TableStore`/`KeyValueStore`, **on by default** in `createGasRuntime`. Writes are restricted to `*_port` tabs and `PORT_` keys; **reads are unrestricted**, which is not a loophole but a requirement. Plus `assertPlanIsAllowed`, an up-front check the applier always runs ([why](#b4b-two-rails-and-the-hole-between-them)) | **Met.** 84 tests. `Overdue` throws while `Overdue_port` succeeds; `TODOIST_LAST_SYNC` throws while `PORT_TODOIST_LAST_SYNC` succeeds; a plan aimed at a production tab is refused **before even a read is issued** — dry runs included |
| **B4c** ✅ | **Dry-run mode**, reachable from the editor. The applier already logged instead of applying (B2) and refused a bad plan either way (B4b); what was missing was a way to *ask* — the Run button passes no arguments. The build now generates a **`…DryRun` twin** for every entry point that declares `writes`, sitting directly beneath its real counterpart in the dropdown. Also `pingWrite`, the first entry point that writes anything ([findings](#b4c-a-dry-run-you-can-actually-reach)) | **Met.** 90 tests. A dry run of `pingWrite` creates no tab, persists no state, and still logs the row it would append; a real run creates `Ping_port` and writes `PORT_PING_LAST_RUN` |
| **B5** ✅ | `src/adapters/node/` — all seven ports. **Four are already real**: `Clock` (with a genuinely synchronous `sleep` via `Atomics.wait`), `Logger`, `IdGenerator` (`crypto.randomUUID`) and a TTL-honouring `CacheStore`. Three throw `notImplemented` naming the step that will write them ([findings](#b5-the-bill-for-a-synchronous-seam)) | **Met.** 104 tests. The Node runtime satisfies every port, is guarded identically to the Apps Script one, and the stubs fail loudly rather than returning a plausible empty value |
| **B6** ✅ | **The layering test**, [`src/layering.test.ts`](../../todoist/ts/src/layering.test.ts) — four rules, not one: no Google global outside `adapters/gas/`, no Node built-in outside `adapters/node/`, no adapter import from `core`/`services`/`pipelines`, and a self-test proving the detector fires ([findings](#b6-a-test-that-can-actually-fail)) | **Met, and proved by mutation.** Adding `SpreadsheetApp.openById()` to `core/row.ts` made it fail with `core/row.ts: SpreadsheetApp`; removing it made it pass again |

### Phase C — The pure core

Small, heavily tested, and where the naming rules get established for everything after.

| Step | What lands | Proof it's done |
| --- | --- | --- |
| **C1** ✅ | `core/dates.ts` — the duplicate `toDateString` dies here. `formatUtcDay`, `formatDayInTimezone(instant, timezone)`, `cellValueToDayKey`, `cellValueToLocalDay`, `daysBetweenDays`, `addDaysToDay`, `isValidDayKey`. **No ambient timezone anywhere** | **Met.** 19 tests, including the 2026-08-20 evening case from [`history.md`](../../todoist/history.md) and the 23:30 nightly run — the one that finalises the day, and so the one that must not file under tomorrow |
| **C2** ✅ | `core/labels.ts`, `core/numbers.ts`, `core/keys.ts` — label splitting from either shape, `toNumberOrZero` **and** `toNumberOrNull`, the composite dedup keys and a `Set` builder | **Met.** 19 tests. The key test that matters: a recurring task's completions must not collapse to one row ([why](#c1c4-what-porting-the-core-surfaced)) |
| **C3** ✅ | `core/habits.ts` — `habitDayStatus`, `nextStreak`, `dueTimeOf`, `clockTimeOf`, `habitDueTime`, `isRestDay` | **Met.** 24 tests, the scratchpad harness committed — including a 30-day streak walk, both recurrence separators, and the weekend that must not break a streak |
| **C4** ✅ | `core/areas.ts` — the four-step resolution with its `source` marker — and `core/bill-cycle.ts` — status, lag, cycle, streak | **Met.** 20 tests. Includes the multi-label determinism case, a cyclic-parent guard, and the mortgage cycles reading `closed_late` as documented rather than as a bug |

### Phase D — One pipeline per step

Each step is a vertical slice: service descriptors, a pure `plan()` function, an entry point,
tests, and the schema-doc parity check. Each is independently reviewable and independently
abandonable.

| Step | Pipeline | Why in this position |
| --- | --- | --- |
| **D1** ✅ | `services/todoist/` — `requests.ts` (pure descriptors, the `limit=50` cap, the query builder), `responses.ts` (three page shapes, legible non-JSON failures, id→name and tree builders), `fetch-pages.ts` (the one impure function, taking ports so it runs anywhere) | **Met.** 16 tests, including all three page shapes, the empty-page stop, the page budget, and the courtesy delay landing between pages but not after the last |
| **D2** ✅ | Overdue — `pipelines/overdue.ts`, a pure `planOverdue(snapshot, tab, today) → WritePlan`, plus the `portSyncOverdue` entry point wiring fetch → plan → apply | **Met and deployed.** 15 tests against the [schema](../../todoist/schema/overdue.md)'s ten columns; the entry point is live in the editor and writes only `Overdue_port` ([findings](#d1d2-the-first-real-pipeline)) |
| **D3** ✅ | RecurringStatus — `planRecurringStatus`, same `replaceWhere` shape as Overdue | **Met.** 8 tests. The recurrence string is carried **verbatim**, because `HabitDaily` parses the time of day out of it and both separators occur live |
| **D4** ✅ | KarmaStats — the first `upsert`, plus the two-candidate stats endpoint | **Met.** 12 tests, including the re-run case that would otherwise report a karma delta of zero ([findings](#d3d5-three-more-pipelines-and-a-real-bug)) |
| **D5** ✅ | Completions — three sources, the In Review entered-since diff, composite dedup, and `completions-window.ts` for the cursor/clamp/backfill decision | **Met.** 22 tests across the pipeline and the window. **A real dedup bug was found and fixed here** ([findings](#d3d5-three-more-pipelines-and-a-real-bug)) |
| **D6** ✅ | BillCycle — closed cycles from `Completions_port`, the one open cycle per bill from the live list, streaks per bill in cycle order. **The full rebuild `{ all: true }` exists for this tab** | **Met.** 6 tests, including the re-completed cycle that must keep its EARLIEST close, and the renamed bill that must show its current name on historical cycles |
| **D7** ✅ | AreaDaily — snapshot columns C–F, `completed` derived from `Completions_port`, `counts_observed` marking the difference | **Met.** 7 tests. Pins that **API priority 4 is p1** — the UI label and the wire value run in opposite directions — and that `in_week` stays orthogonal to area |
| **D8** ✅ | TaskDaily — 22 columns, work-stage normalisation, exit rows, and the four-case section-age rule | **Met.** 11 tests, including both silent failure modes: prior state must come from the day STRICTLY BEFORE today, and exit rows must be excluded from it ([findings](#d6d9-the-derived-tabs)) |
| **D9** ✅ | HabitDaily — the dense grid, streak threading, the empty-tab auto-backfill, and the clamp that protects synthesised history | **Met.** 9 tests. Writes **nothing at all** when the spine is missing, rather than clearing the grid and refilling it with nothing |
| ~~**D10**~~ | ~~Everhour~~ — **dropped.** Everhour is retired; see [`../../trackingtime/`](../../trackingtime/README.md). If [TrackingTime](../../trackingtime/README.md) is built by the time Phase D runs, write it here *natively* in the new layers rather than porting anything | No parity bar to clear makes it the easiest possible first native integration |
| **D11** ✅ | Reschedule habits — a **pure** `planHabitReschedule` returning `item_update` commands, and a separate step that issues them | **Met.** 18 tests. The guards cannot protect this one — **there is no shadow Todoist** — so the dry run is the only rail, and it is generated from a new `writesExternally` flag ([findings](#d11d12-the-two-write-paths)) |
| **D12** ✅ (logic) | The event-log webhook's parsing and row-building, ported pure and tested. The health webhook's code was **deleted pending a rework** — when it returns, write it in these layers rather than porting the old one | **Met for the logic.** 12 tests. ⚠️ **Not yet deployed**: `event-log` is a separate clasp project and the port bundle is not staged into it, so the live webhook still runs the legacy `.gs`. That is deliberate — swapping a webhook that Apple Shortcuts POST to is a Phase E decision, not a Phase D one |

### Phase E — Cutover

| Step | What happens |
| --- | --- |
| **E0** ✅ | A dated backup copy of `quantified-self-todoist`, left untouched — the rollback for everything E does. **Satisfied by A8 (2026-09-13)**, which is still accurate: the port has only ever written `*_port` tabs. **Retake it before E4**, when the port starts writing the real ones, or if a long gap opens first |
| **E1** | `port`-prefixed triggers installed alongside the legacy ones, **offset by 15–30 minutes so the two never run together** ([why](#running-two-implementations-at-once)). Legacy keeps writing the real tabs; the port writes only `*_port` tabs |
| **E2** | Both run for several days — same spreadsheet, **disjoint tab sets**, identical input data and timing |
| **E3** | A diff harness compares `X` against `X_port` for every tab. Row-for-row equality is the bar for `Overdue`, `KarmaStats`, `RecurringStatus`, `HabitDaily`, `BillCycle`. **One expected divergence**: the port retries transient HTTP failures and the legacy does not, so the port may hold a row for a day the legacy lost to a blip ([why](#the-first-real-failure-a-503-and-what-it-cost)) |
| **E4** 🔶 | **The swap**, in one sitting: disable the legacy triggers, drop the `port` prefix from the generated globals and the `_port` suffix from the tab targets, delete the old `*_port` tabs, promote `PORT_` state keys to their real names, and install the triggers under their final names. Keep the legacy `.gs` in the project but **untriggered** for a week as rollback |
| **E5** | Freeze the legacy `.gs` files — a header line on each saying so |
| **E6** | `docs/todoist/architecture.md` rewritten once, to describe `todoist/ts/` |

**`TaskDaily` and `AreaDaily` cannot be replayed.** Their snapshot columns derive from their own
previous day, so a missed day is a permanent hole no re-run fills — both schema docs say so, and
`AreaDaily` carries `counts_observed` to mark it. Cut those two over on a day both
implementations ran, and verify the carried columns survive the seam before disabling anything.

**What "rollback" actually means after E4**, since "keep the legacy untriggered for a week" is
only half a plan:

1. Re-enable the three legacy triggers (`syncTodoist`, `syncTodoistIntraday`, `checkBillRisk`)
2. `git revert` the E4 commit and `npm --workspace todoist/ts run push:sync` — the legacy `.gs`
   are still in the repo and still in the project, so this is a push, not a restore
3. Rename the state keys back: E4 promoted `PORT_TODOIST_LAST_SYNC` to `TODOIST_LAST_SYNC`, and
   the legacy run will read whatever is there
4. Accept that rows written by the port between E4 and the rollback stay — they are in the real
   tabs now. If they are wrong, the dated E0 copy is the source for repair

**Step 3 is the one that bites.** Both implementations read the same cursor, so a rollback
after several port-run days hands the legacy code a cursor the port advanced. Verify
`Completions` has no gap before standing down.

**The `*_port` tabs have to be created.** Nothing creates them today. The GAS `TableStore`
should create a missing `_port` tab with the header its pipeline declares, which also gives
`archiveAndRecreateSheet()`-style header drift somewhere safe to happen — a wrong header
constant then breaks a shadow tab instead of archiving a real one.

### Phase F — GitHub Actions

Only after E. The scheduled syncs move; the webhooks never do.

| Step | What lands |
| --- | --- |
| **F1** 🔶 | Service account, Sheets API enabled, granted Editor on `quantified-self-todoist`. With no test copy to practise against, the runner's first writes go to `*_port` tabs and the tab-name guard (B4b) stays on until F5 — that guard is now the only thing standing between a misconfigured runner and the real tabs |
| **F2** | `adapters/node/` filled in: Sheets API `TableStore`, `fetch` transport, `_State` tab `KeyValueStore`, `Map` cache |
| **F3** | `entrypoints/node/` CLI, driven by the same registry as the GAS entry points |
| **F4** 🔶 | Workflow + secrets: `TODOIST_TOKEN`, `TODOIST_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON` |
| **F5** 🔶 | Service account promoted to Editor on live; schedule moved to cron with a `concurrency` group; Apps Script triggers disabled but retained |

Reliability notes that shape F5: GitHub cron is UTC-only and best-effort under load, runs only
on the default branch, and **GitHub disables scheduled workflows after 60 days of repository
inactivity** — a live risk for a personal repo. Mexico City has had no DST since 2022, so 23:30
local is `30 5 * * *` year-round and the intraday window is `0 13-23,0-4 * * *` — but the in-code
07:00–23:00 guard **stays**, so the cron expression is never load-bearing. The nightly run
finalises the day, so it must compute its own target day rather than trusting the wall clock.

---

## Reference

### Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Existing `.gs` | **Kept, untouched, deployed** | The port is a parallel tree, not a refactor. The legacy `.gs` files stay the running implementation *and* the thing the port is diffed against, right through Phase E |
| Port location | `todoist/ts/`, a self-contained **npm workspace** | Every Node/TS/clasp config lives *inside* the workspace, so the repo root stays free of them and free for a future `app/` Swift project. It sits under `todoist/` because that is what it ports — if a second integration is ever written in these layers, this is the decision to revisit |
| Language | TypeScript, **erasable syntax only** | Node 24 runs `.ts` directly (type stripping is on by default), so tests need no build and no new dependency. The price: no `enum`, no `namespace`, no parameter properties — use `const` objects and `import type` |
| Build | esbuild → one IIFE bundle per Apps Script project | Apps Script has no module loader. One dependency, sub-second |
| Deploy payload | `dist/<project>/` is **paste-ready** — exactly one bundled file per project | clasp auth does not travel between machines, so a manual copy-paste must stay a practical fallback from anywhere. This is why the bundle is one file rather than several ([A4 #3](#a4-the-three-decisions-settled)) |
| **Async is banned in shared code** | Pipelines and services are synchronous; `async` exists only in `adapters/node/` | An Apps Script trigger cannot `await`: the entry point returns before the promise settles, so a **rejected** promise never reaches the executions dashboard and a failed nightly run reports success. The current code throws deliberately so failures surface there — that must survive the port |
| I/O shape | **Fetch → pure plan → Apply** | Makes the async ban free: the pipelines do no I/O, so they need no opinion about sync vs async, and the same code runs under both runtimes. This *is* the service/integration split — everything above `ports/` is pure, everything below is platform |
| Write model | A `WritePlan` value with three verbs — `append`, `replaceWhere`, `upsert` | Replaces eight hand-rolled write strategies with three, and maps 1:1 onto the tab-strategy table in [`todoist/README.md`](../../todoist/README.md) — the invariant the port must not break |
| Write target during the port | **Production**, `quantified-self-todoist`, but only into **shadow tabs** (`Overdue_port`, `TaskDaily_port`, …) until E4 | Your call on 2026-09-10: one project, git as the safety net. Git protects the code, not the data, so the isolation has to come from somewhere else — writing to tabs no legacy code reads means a wrong plan corrupts a scratch tab, not four years of history. A dated backup (A8) covers the rest |
| Config default | **Fail closed.** No spreadsheet ID is baked in; an unset target throws | A default that silently resolves to production is how a test run becomes an incident |
| Timezone | Explicit `timezone` config + `Intl.DateTimeFormat`; `Session.getScriptTimeZone()` deleted | A GitHub runner is UTC and has no ambient script timezone, so the ambient read must become a value. `history.md` records the 2026-08-20 seam this already caused once |
| State under Actions | A `_State` tab in the same spreadsheet | The cursor and In Review membership need somewhere durable. Actions cache expires in 7 days; repo commits are noisy; a tab needs no new credential |
| Cache under Actions | In-process `Map`, no TTL | A run is a fresh process, so a 6-hour TTL is meaningless. Costs one `/projects` + one `/sections` call per run |
| Tests | `node --test` over `todoist/ts/src/**/*.test.ts` | Zero new dependency on Node 24. Overrides the CLAUDE.md "no test framework unless asked" norm — asked for, because parity is the only proof the port is correct |
| Lockfile | **Now committed** | `npm ci` in Actions requires it, and there are real dependencies for the first time |
| Webhooks | Never leave Apps Script | Apple Shortcuts POST to a Web App URL, and a scheduled Actions job has no inbound endpoint. `event-log/` gets ported at D12; the health webhook is deleted pending a rework and should be *written* in these layers rather than ported |

### Layers and layout

```text
todoist/              # the integration — the parity reference
├── legacy-implementation/   # the 10 deployed .gs; frozen at the Phase E cutover
├── schema/           # the tab contracts — the port's specification
├── looker/           # Looker Studio specs
└── ts/               # the port — one self-contained npm workspace
    ├── package.json  tsconfig.json  .clasp.example.json
    ├── appsscript/           # manifest per Apps Script project
    ├── src/
    │   ├── core/             # pure — dates, keys, habits, areas, write-plan
    │   ├── services/         # pure — endpoint descriptors, parsers, row mappers
    │   ├── pipelines/        # pure — snapshot → WritePlan, one per tab
    │   ├── ports/            # interfaces only, no implementations
    │   ├── adapters/gas/     # the ONLY place a Google global may appear
    │   ├── adapters/node/    # googleapis, fetch, env, Map
    │   ├── entrypoints/      # the registry, and the thin per-runtime shells
    │   └── **/*.test.ts      # beside the unit under test
    ├── dist/                 # gitignored. clasp pushes from here
    └── README.md             # the human-readable architecture doc
health/               # schema only — webhook deleted pending rework
event-log/            # webhook + schema + every Apple Shortcut. Ported last (D12)
trackingtime/         # not built
```

| Layer | Contains | Platform-aware? |
| --- | --- | --- |
| `core/` | Dates, keys, habit status, streaks, area resolution, the `WritePlan` types | **No.** Pure, and the most heavily tested |
| `services/` | Per-source knowledge: request descriptors, parsers, row mappers, the pagination rule | **No.** Describes requests, never issues them |
| `pipelines/` | One per tab: `planX(snapshot, config, today) → WritePlan` | **No.** The nightly logic, with zero I/O |
| `ports/` | Seven interfaces, plus the cell/row value types | The seam itself |
| `adapters/` | `gas/` and `node/` implementations | **Yes**, and nowhere else |
| `entrypoints/` | The registry plus ~8 lines per entry point | Yes |

**One rule enforces the seam**: `SpreadsheetApp`, `UrlFetchApp`, `PropertiesService`,
`CacheService`, `Session`, `Utilities` and `Logger` may only be named inside
`src/adapters/gas/`. Step B6 makes that a test, which is what keeps the port agnostic a year
from now when neither of us remembers this document.

Three types carry the design:

```ts
// ports/http.ts — synchronous by contract. GAS satisfies it natively;
// the Node adapter satisfies it by resolving before it returns.
export interface HttpTransport {
    get(url: string, headers: Record<string, string>): HttpResponse;
    post(url: string, headers: Record<string, string>, body: string): HttpResponse;
}

// core/write-plan.ts — the three verbs
export type WriteOperation =
    | { mode: "append"; tab: string; rows: Row[] }
    | { mode: "replaceWhere"; tab: string; column: number; match: Match; rows: Row[] }
    | { mode: "upsert"; tab: string; keyColumn: number; rows: Row[] };

export type Match =
    | { equals: string }
    | { onOrAfter: string }
    | { all: true };   // added at B2 — BillCycle is a full rebuild

export interface WritePlan {
    writes: WriteOperation[];
    stateToPersist: Record<string, string>; // written only AFTER the rows land
    logLines: string[];
}
```

`Match` is a predicate rather than a bare equality because `HabitDaily` replaces a trailing
*window*, not one day, and `BillCycle` replaces **all** of them. Everything else uses `equals`.

### One project: what changes

Decided 2026-09-10: **no staging project and no test spreadsheet.** The port is developed in
*Quantified Self - Todoist Sync*, against `quantified-self-todoist`, with git as the recovery
mechanism for the code. Three consequences follow mechanically, and none of them is optional.

**1. The port's entry points must be renamed, or they silently replace the legacy ones.**
Apps Script concatenates every file in a project into one flat global scope. All **11** of the
port's planned entry-point names already exist as legacy globals:

```text
syncTodoist  syncTodoistIntraday  checkBillRisk  syncOverdue  syncCompletions
syncHabitDaily  syncAreaDaily  syncTaskDaily  syncBillCycle  syncKarmaStats
syncRecurringStatus
```

Two definitions of `syncTodoist` in one scope is not an error — the last one concatenated wins,
and nothing reports it. The nightly trigger would then run whichever version happened to load
last. That is precisely the class of bug this port exists to eliminate, so until cutover **every
port global carries a `port` prefix**: `portSyncTodoist`, `portSyncOverdue`. The entry-point
registry generates these names, so the prefix is one line in the esbuild footer, and dropping it
is part of E4.

**2. `clasp push` replaces the whole project, so one directory must hold both.** A push deletes
remote files absent from `srcDir` — proven by the A5 push, which removed all ten
display-named files. Pushing `dist/port/` alone would therefore **delete the running legacy
implementation**. From B4 on there is one staging directory containing the ten legacy `.gs`
*and* the port bundle, pushed together.

**3. Phase E cannot compare two spreadsheets, so it compares two tab sets.** The port writes
`Overdue_port`, `TaskDaily_port` and so on — tabs no legacy code reads and no Looker source is
bound to. Parity is a diff between `X` and `X_port` inside the one spreadsheet. This is
*better* than it sounds: both implementations see identical input data on identical timing,
which two spreadsheets could never guarantee.

| What used to isolate | What isolates now |
| --- | --- |
| A separate Apps Script project | A `port` prefix on every generated global |
| A separate spreadsheet | A `_port` suffix on every tab the port writes |
| Separate Script Properties | One shared set — so the port **must not write** `TODOIST_LAST_SYNC` or `TODOIST_IN_REVIEW_PREV`; it reads them and persists its own cursor under `PORT_` keys |

> ⚠️ **The Script Properties point is the sharpest edge left.** The legacy sync and the port now
> share one property store. If the port advances `TODOIST_LAST_SYNC`, the *legacy* nightly run
> skips that window and `Completions` loses rows — corruption at a distance, in a tab the port
> never touched, and the failure is invisible until someone notices a gap. Every port write to
> a shared key goes under a `PORT_`-prefixed name. B4b enforces this with a test.

### Safety rails without a second project

The port is unproven code whose write model is *delete these rows, then write these* — and as
of 2026-09-10 it runs in the production project against the production spreadsheet, with git as
the stated safety net.

**Be precise about what git covers.** It versions the `.gs` and the TypeScript, so a bad *code*
change is recoverable in seconds with `clasp push`. It holds none of this:

| Not in git | Why it matters |
| --- | --- |
| The spreadsheet | Four years of rows, some of which cannot be re-fetched from anywhere |
| Script Properties | `TODOIST_LAST_SYNC`, `TODOIST_IN_REVIEW_PREV`, the token, the spreadsheet ID |
| Apps Script triggers | Which functions run, and when |

So the rails below replace the separate project. The first is the only one that protects the
irreplaceable data, and it is one menu click. **The first one exists as of 2026-09-13 (A8).**

| Rail | What it is | What it catches |
| --- | --- | --- |
| **A dated backup copy** (A8) ✅ | File → Make a copy, named with the date, never written to. Taken 2026-09-13 and still current — the port writes only `*_port` tabs, so nothing it has done since is in scope for a restore. **Retake before E4** | The unrecoverable case. Nothing else on this list restores a deleted `TaskDaily` row |
| **Tab-name guard** (B4b) | The `TableStore` refuses any tab not ending `_port` unless `allowProductionTabs` is explicitly true | The port writing a tab the legacy code owns, or Looker reads |
| **State-key guard** (B4b) | The `KeyValueStore` refuses any key not starting `PORT_` | The port advancing the legacy cursor — see below |
| **Fail-closed config** | No spreadsheet ID has a default; an unset target throws | A missing property silently resolving to something |
| **Dry-run** (B4c) | The applier logs the `WritePlan` instead of applying it | Everything, before it happens. **More important now, not less** — it is the only rail that costs nothing to leave switched on |

**What corruption would actually look like**, so the cautions aren't abstract:

- **`TaskDaily` and `AreaDaily` are unrecoverable.** Their snapshot columns derive from their own
  previous day and Todoist keeps no history of what was open on a past date. A stray
  `replaceWhere {equals: today}` deletes rows that cannot be re-fetched, re-derived, or
  reconstructed. This is the highest-severity outcome in the whole plan, and the dated backup is
  the only defence against it.
- **`Completions` is append-only with a persisted cursor.** The port and the legacy sync now share
  one property store. If the port advances `TODOIST_LAST_SYNC`, the *legacy* nightly run skips
  that window and `Completions` loses rows — corruption at a distance, in a tab the port never
  wrote, invisible until someone spots the gap. Hence the `PORT_` key prefix.
- **`HabitDaily` rebuilds a trailing window**, so a bad run wipes the window and rewrites it
  wrong. Recoverable — `backfillHabitDaily()` exists — but only if `Completions` and
  `RecurringStatus` are still intact underneath.
- **A layout guard can archive a tab.** `archiveAndRecreateSheet()` fires on an incompatible
  header, so a port with a wrong header constant doesn't error — it renames your tab and starts
  a fresh empty one. Every Looker Studio data source bound to that tab breaks at once.

**Three rules that need no tooling.**

1. **Never use the editor's Run button on a port function** while both implementations share the
   project. It runs with production properties against production data, with no dry-run flag set.
   Trigger it or call it from a wrapper that sets `dryRun: true`.
2. **Take a dated copy before E4**, the moment the port stops writing shadow tabs.
3. **Never let a port entry point keep a legacy name.** The `port` prefix is what stops a
   half-finished pipeline from quietly becoming the nightly run.

### Running two implementations at once

Phase E runs the legacy sync and the port **in the same project, on the same schedule, against
the same spreadsheet and the same Todoist token**. Nothing in the current code anticipates
that, and three limits bite before correctness does.

| Limit | What doubles | What to do |
| --- | --- | --- |
| **Apps Script daily runtime quota** — roughly 90 min/day on a consumer account; confirm yours | Two full syncs per night instead of one | Stagger, and keep the parallel window to days rather than weeks. If the quota is hit, *the legacy run* may be the one that dies |
| **Todoist API rate limit**, per token | Every request the sync makes | Offset the port's triggers by 15–30 minutes so the two never overlap. There is no second token |
| **6-minute execution cap**, per run | Nothing — but see below | The port must not be slower than the legacy run it replaces |

**There is no locking anywhere.** `LockService` appears in none of the ten `.gs` files, so two
simultaneous runs would interleave their `SpreadsheetApp` calls. With disjoint tab sets that is
survivable, but it is luck rather than design. **Offsetting the schedules is the mitigation**;
if the port ever needs to write a tab the legacy code owns, a script lock becomes mandatory
first.

**The 6-minute cap is unhandled today and the port inherits the problem.** No `.gs` file checks
elapsed time or carries a deadline — a run that grows past six minutes is simply killed
mid-write. The `WritePlan` shape helps here in a way worth naming: because a plan is built
before anything is applied, a future time-budget check can stop *between* operations rather
than inside one, which is the difference between a partial run and a corrupt tab. Phase D
should not add that machinery speculatively, but **D8 (`TaskDaily`) and D9 (`HabitDaily`) are
where it will first be needed** — they are the largest writers.

### The orchestrator's ordering invariant

`syncTodoist()` runs eight steps in a fixed order, and the order is load-bearing. It is
documented in comments inside
[`todoist-sync.gs`](../../todoist/legacy-implementation/todoist-sync.gs) but was never stated in
this plan, which made the Phase D sequence look arbitrary:

```text
Completions ─┬─> BillCycle    (derives from Completions)
             ├─> AreaDaily    (derives from Completions)
             └─> TaskDaily    (live task list; grouped with the area work)
Completions ─┐
RecurringStatus ─┴─> HabitDaily   (LAST — rebuilds its grid from both tabs)
```

`Overdue`, `KarmaStats` and `RecurringStatus` are independent and may run in any order.
**`HabitDaily` must run last**, because it reads the rows the others have just written for
today. Phase D's step order (D5 Completions → D6/D7/D8 → D9 HabitDaily) respects this; any
resequencing must too. Each step is also run in isolation so one failing endpoint cannot abort
the rest, and failures are collected and rethrown at the end so they surface in the executions
dashboard — behaviour the port must preserve, and the reason the async ban exists.

### Naming rules

The rule that does the most work: **a function's verb declares its layer.** You can tell
whether a function is allowed to touch the platform by reading its name, and the layering test
in B6 backs it up.

| Verb | Layer | Means |
| --- | --- | --- |
| `format`, `parse`, `build`, `compute`, `plan`, `is`, `has` | `core/`, `services/`, `pipelines/` | Pure. Same input, same output, no I/O, ever |
| `fetch`, `read`, `write`, `apply`, `push` | `adapters/`, `entrypoints/` | Touches the outside world |

So `planOverdue()` may never contain a `fetch`, and `fetchAllPages()` may never live in
`pipelines/`. Beyond that:

- **No single-letter identifiers**, including `t`, `e`, `d`, `n`, `r`, `p` — the current code
  uses all six. Loop counters are `rowIndex`, `pageIndex`.
- **Booleans read as assertions**: `isHabitPastGracePeriod`, `hasAreaLabel`, `shouldSkipToday`.
- **Longer beats clever.** `toNumberOrZero` over `num`; the extra 11 characters are read far
  more often than they are typed.

Representative renames, to set the tone rather than to enumerate every case:

| Today | Ported |
| --- | --- |
| `num(v)` | `toNumberOrZero(value)` |
| `toDateString(date)` ×2 | `formatUtcDay(date)` — one definition |
| `localDateString(date)` | `formatDayInTimezone(date, timezone)` |
| `dateKey(cellValue)` | `cellValueToDayKey(cellValue)` |
| `todoistGetPaged(path, params)` | `fetchAllTodoistPages(path, params)` |
| `isStale(task, now)` | `isHabitPastGracePeriod(task, now)` |
| `describe(r)` | `describeResponseShape(response)` |
| `getExistingIds(sheet, col)` | `readExistingIdsFromColumn(sheet, column)` |
| `qs` | `queryString` |

Comments are the one thing that does **not** get rewritten. The `.gs` files carry hard-won
explanations — why `limit=50` is a cap and not a preference, why an empty page breaks
pagination, why two date formatters exist. Those move across verbatim; they are the most
valuable prose in the repo.

### Entry points: one registry

Today ~30 callable functions are scattered across the 10 `todoist/legacy-implementation/*.gs` files with no index. Instead, one array is
the single source of truth:

```ts
// entrypoints/registry.ts
export const entryPoints = [
    {
        name: "syncTodoist",
        kind: "trigger",
        schedule: "daily 23:30 local",
        writes: ["Completions", "Overdue", "KarmaStats", "RecurringStatus",
                 "BillCycle", "AreaDaily", "TaskDaily", "HabitDaily"],
        summary: "The run that finalises the day.",
        run: runTodoistSync,
    },
    // … one entry per callable, grouped: trigger | manual | backfill | diagnostic
] as const;
```

Three things read that array, so none of them can drift:

1. **The esbuild footer** generates the Apps Script globals from it — adding an entry to the
   registry is what makes it callable in the editor. Nothing else exposes a global.
2. **The Node CLI** dispatches on it, so both runtimes expose exactly the same set.
3. **`todoist/ts/ENTRYPOINTS.md`** is generated from it — a table of every entry point, its kind,
   its schedule, and the tabs it writes. A test asserts the file matches the registry.

Each entry point stays ~8 lines, and they are the only place the three phases meet:

```ts
// entrypoints/gas/todoist.ts
function runOverdueSync() {
    const runtime = createGasRuntime();                                  // adapters
    const today = formatDayInTimezone(runtime.clock.now(), config.timezone);
    const openTasks = fetchAllTodoistPages(runtime.http, overdueRequest()); // integration
    const plan = planOverdue({ openTasks, projects }, config, today);      // pure
    runtime.tables.apply(plan);                                           // integration
    plan.logLines.forEach(runtime.log);
}
```

The Node shell is the same six statements with `await` on the two integration lines. That
duplication is deliberate and bounded: it is the *only* code written twice.

### Doc upkeep

The real risk of a parallel port is two implementations and one set of docs describing neither.

1. **One owner per document.** [`../todoist/architecture.md`](../todoist/architecture.md)
   describes *the deployed implementation* — the `.gs` files until Phase E, `todoist/ts/` after,
   rewritten once at E6. There is never a second architecture doc; until then it gains one line
   pointing here.
2. **`todoist/ts/README.md` is the human-readable architecture doc** — written for someone
   reading it cold: what each layer is, why the seam exists, and one request traced end to end
   through all six layers, with a Mermaid diagram matching the style already used in
   [`../diagrams.md`](../diagrams.md).
3. **The schema docs are the port's specification.**
   [`../../todoist/schema/`](../../todoist/schema/) describes tab columns and
   behaviour, not code, so it serves both implementations unchanged. Their "Behaviour and edge
   cases" tables are the parity checklist for each Phase D step — a pipeline is done when its
   tests read like its schema doc.
4. **Doc updates ride inside the step**, never after it.
5. **Two mechanical tripwires**, because rules 1–4 rely on memory and these don't: the
   `ENTRYPOINTS.md` check above, and a test that parses the column tables out of `schema/*.md`
   and asserts they match the header constants in the TypeScript — the drift that happens every
   time someone adds a column and forgets the doc.
6. **`CLAUDE.md` is updated in Phase A**, not at the end, because it steers every future session.

---

## Findings

What the live projects actually contained, and what each discovery changed. Kept because
several of these corrected claims earlier revisions of this plan made confidently and wrongly.

### What the A3 pull found

Both standalone projects pulled into the scratchpad and diffed against the repo, with
formatting normalised on both sides so whitespace could not mask content. **9 of 11 files are
byte-identical.** Nothing exists in an editor that is missing from the repo, so a push would
destroy nothing — with one small exception, noted in the table.

| Finding | Detail |
| --- | --- |
| **There are two standalone projects, not one** | *Quantified Self - Todoist Sync* (10 files) and *Quantified Self - Everhour Sync* (1 file, still named `Código.js`). The docs describe a single `quantified-self-sync` project holding both; that has never been true. This **settled the "one project or two?" open question** — it was already two. Since superseded: Everhour has been retired, so only the Todoist project is ported |
| **The life-areas code is already deployed** | All four files — Areas, Area Daily, Bill Cycle, Task Daily — are live and byte-identical to the repo. [`life-areas.md`](life-areas.md) said "Nothing is deployed / none of it has been pasted into Apps Script yet", which was **stale** — corrected at A6. Whether the *tabs* existed was a separate question this pull could not answer; **A6 confirmed they do** |
| **The editor is behind in one file** ⚠️ | *Habit Daily Grid* still defines `localDayOf()`, which the repo moved into Utilities. The live project therefore defines it **twice**. Harmless today — identical bodies — but it is a real collision, and pushing the repo fixes it. **A4 #2 confirmed the deduplicated version ships**, so A5's push is the fix |
| **The editor is ahead in one comment** | *Sync Sections* mentions `Fullsteam / Ascensus / Work`; the repo said `Ascensus / Work` **at the time of the pull**. Comment-only — `TARGET_PROJECTS` was identical in both — so a push would lose a stale note, not behaviour. **A4 #1 then settled it: both `Fullsteam` and `Ascensus` are retired**, and the repo now says `Work` alone |
| **Manifests captured** | Both are identical and minimal: `timeZone: America/Mexico_City`, `runtimeVersion: V8`, `exceptionLogging: STACKDRIVER`. This **confirms the timezone** the whole date layer depends on, and they are the manifests A4 brings into the repo |
| **Webhook projects not yet pulled** | Bound scripts do not appear in Drive and clasp v3 has no `list`, so their Script IDs must come from each spreadsheet's *Extensions → Apps Script → Project Settings* |

### A4: the three decisions, settled

All three are answered. **The repo already matched every answer**, so A4 changed no code — it
turned three unknowns into recorded intent, which is what unblocks A5.

| # | Decision | Answer | What follows |
| --- | --- | --- | --- |
| 1 | Is `Fullsteam` a real target project? | **No — and neither is `Ascensus`** | Both projects have been deleted from Todoist (verified against the live account: 21 projects, active *and* archived, and neither name appears). `TARGET_PROJECTS` in [`todoist-sync.gs`](../../todoist/legacy-implementation/todoist-sync.gs) is now `["Work"]`, so the In Review filter is `#Work`. This was the one A4 answer that **changed code** — see [the scope reduction](#the-in-review-scope-reduction) |
| 2 | Does the deduplicated `localDayOf` ship? | **Yes** | The repo's single definition in [`todoist-sync-utils.gs`](../../todoist/legacy-implementation/todoist-sync-utils.gs) survives; the editor's second copy in *Habit Daily Grid* disappears on push. This makes A5 the step that **repairs a live collision**, not merely a change of deployment mechanism |
| 3 | Where does the manifest belong? | **`todoist/ts/appsscript/`** — where it already sits | Judged against the criterion you gave: iterate and test in TS, then deploy whatever `dist/` holds. Keeping the manifest out of `src/` means no test or typecheck glob ever meets a deploy artefact, and staging it into `dist/<project>/` makes that directory the *complete* payload — everything you would push **or paste** is in one place |

#### `dist/` is a paste-ready payload, not just a clasp staging directory

Answer 3 carried a requirement the plan did not previously have: *"allow me to just copy and
paste whatever is in dist"*. That is a second deploy path, and it earns its place — clasp auth
does not travel between machines, so paste is the only way to deploy from a machine that has
never run `clasp login`. Three consequences:

- **The B4 build emits exactly one file per project.** A bundle split across several files
  would make a manual deploy ten select-all-pastes; one file makes it one. The IIFE + generated
  global footer already produce this shape — it is now a requirement rather than a convenience.
- **The manifest is pasted separately, and only when it changes.** Apps Script hides
  `appsscript.json` until *Project Settings → Show "appsscript.json" manifest file in editor*
  is ticked. Worth ticking once per project. In practice it changes when a scope or the
  timezone changes, which is rare.
- **A5's legacy staging is the exception.** It stages the ten existing `.gs` files unbundled,
  because they are pushed by clasp and diffed file-by-file against the editor. The paste path
  matters for the *port's* output, from B4 onward.

> **A one-way door worth naming.** Once the editor holds a single generated bundle, the
> file-by-file diff that made A3 trustworthy stops working — one file on one side, ten on the
> other. That is acceptable *after* cutover, when the repo is the source and the editor is
> generated output, but it is precisely why A3 had to happen while the two sides were still
> comparable. Phase E's parity check must therefore run on **tab data**, not on source diffs.

#### The In Review scope reduction

`Ascensus` and `Fullsteam` no longer exist in Todoist, so the In Review completion source now
targets one project instead of two.

| Changed | From | To |
| --- | --- | --- |
| `todoist-sync.gs` | `TARGET_PROJECTS = ["Ascensus", "Work"]` | `["Work"]` |
| The filter it builds | `#Ascensus \| #Work` | `#Work` |

**No data is affected.** `Ascensus` held 0 tasks by both filter and `project_id` from before
the life-areas reorg — [`life-areas.md`](life-areas.md) recorded that at the time — so no
`Completions` row ever originated there and nothing needs backfilling.

**The area maps needed no edit.** `AREA_BY_PARENT_ID` and `AREA_BY_PROJECT_ID` in
[`todoist-areas.gs`](../../todoist/legacy-implementation/todoist-areas.gs) resolve by **project ID**, not by name, so
a deleted project simply stops appearing in the tree. Every ID in those maps still matches a
live project. This is the payoff of the ID-based design that life-areas chose deliberately —
a name-based map would have needed hand-editing here.

> ⚠️ **One risk got worse.** The In Review query is still name-based, and it is now a
> **single-name** query. Previously a rename of `Work` cost half the source; now it costs all
> of it, silently — the filter returns 0 tasks rather than erroring. `#Work` binds to the child
> project and not to the `💼 Work` parent, which life-areas verified with `##Work`, so the
> parent does not rescue it either. Converting this source to `project_id` is worth doing
> during the port; it is logged under
> [`life-areas.md`](life-areas.md#known-gaps-and-open-items).

### clasp v3.4.1, verified

| Finding | Consequence |
| --- | --- |
| `-P, --project <file>` selects a config | Multiple projects from one workspace works as planned: `.clasp-sync.json` and `.clasp-log.json` today, plus `.clasp-health.json` when the health webhook is rewritten |
| `srcDir` is the v3 name (`rootDir` still accepted), and clasp **refuses a `srcDir` that escapes the config's own directory** | A config in `todoist/ts/` cannot reach up to `todoist/`. The restructure did weaken the original argument — one integration per directory means a `.clasp.json` could now sit in `todoist/` and push in place — but the staged `dist/<project>/` in A5 still wins: clasp also pushes `.ts`, so an in-place push would upload `todoist/ts/src/**` unless a `.claspignore` fought it; the manifest would have to live in the source tree; and staging keeps clasp from ever writing into the working tree |
| `clasp status` lists exactly what would be pushed, changing nothing | A free dry-run. Run it before every `push:*`, and especially before the first |
| `clasp pull` writes into `srcDir` | Which is why A3 pulls into the scratchpad. A careless pull is as destructive as a push, in the other direction |

> ⚠️ **A3 is the one destructive gate in the whole plan.** `clasp push` overwrites the editor.
> Only a diff proves the editor isn't *also* ahead somewhere else. That gate has now been
> passed twice: once at A3, and again immediately before the A5 push attempt, because the repo
> had changed in between. **Re-diff before any push that follows a repo change** — a stale
> A3-era diff is not evidence about today's editor.

### A5: the first push, and what it did

**Done for `sync`.** The Todoist project was pushed and then verified by re-reading the
remote: 11/11 files match `dist/sync/`, nothing stale was left behind, and the editor's files
now carry the repo's names. The record below is kept because the pre-push diff is what made
the push safe, and the trap that stopped the first attempt will recur on the next new project.

The pre-push diff, taken by re-reading the live project after the Ascensus change because
A3's diff predated it:

| Check | Result |
| --- | --- |
| **Manifest** | Semantically identical to live, but **not byte-identical** — which was enough to stop the first attempt. See [the manifest trap](#the-manifest-trap-that-stopped-the-first-push) |
| **Files** | 10 live `SERVER_JS` files, all mapped to a repo file. **Nothing existed in the editor that the repo lacked** |
| **Content** | 5 identical, 5 where the **repo was ahead** — and every one intended |

The five differences, all repo-ahead:

| File | Difference | Origin |
| --- | --- | --- |
| `todoist-sync.gs` | `TARGET_PROJECTS` drops `Ascensus` | A4 #1 |
| `todoist-sync-sections.gs` | Comments; live still says `Fullsteam / Ascensus / Work` | A4 #1 |
| `todoist-habit-daily.gs` | The **duplicate `localDayOf()` disappears** | A4 #2 — the collision this push repairs |
| `todoist-area-daily.gs`, `todoist-task-daily.gs` | The dead `Ascensus` example replaced in a comment | A4 #1 |

> **The push renamed every file in the editor** — approved beforehand. Apps Script file names
> come from the pushed filenames, so the old display names (*Todoist Sync Utilities*,
> *Todoist Sync - Habit Daily Grid*) are now the repo's kebab-case names
> (`todoist-sync-utils`, `todoist-habit-daily`).
> Content is unaffected and the flat global scope does not care, but ten files visibly change
> name. **Verified safe on ordering:** every top-level `const` in all ten files is a
> self-contained literal — the only cross-reference, `HABIT_DAILY_STREAK_COL`, reads a
> constant in its own file — so the alphabetical concatenation order a push imposes cannot
> produce a temporal-dead-zone error.

#### The manifest trap that stopped the first push

On the first attempt, `push:sync` staged correctly and then printed a bare `Skipping push.`
— **and exited 0.** Nothing reached the editor, confirmed by re-reading the project
afterwards. **Resolved** by option 2 below; the manifest in the repo now has no trailing
newline and matches live byte-for-byte, so a plain `push` no longer prompts.

The cause is one byte. `clasp push` prompts before overwriting a remote manifest that differs
from the local one, and with no TTY to answer, it declines and skips *the entire push* — not
just the manifest. Our `appsscript/todoist.json` differs from live only by a **trailing
newline** the live copy lacks. Semantically identical, byte-different, and that is the
comparison clasp makes.

Two ways past it. The second is better:

1. `clasp -P .clasp-sync.json push --force` — the flag exists for exactly this, but it silences
   *every* future manifest difference, including a real OAuth-scope change.
2. **Strip the trailing newline from `appsscript/todoist.json`**, so the staged manifest is
   byte-identical to live and there is nothing to prompt about. A plain `push` then works, and
   `push:*` keeps its ability to stop on a genuine manifest change. Once done, the two agree
   permanently.

Keep `--force` out of the `push:*` scripts either way: a manifest carries OAuth scopes and, for
a bound Web App, its access settings. A push that changes one should stop and ask.

> ⚠️ **`clasp push` exits 0 when it skips.** This is the sharp edge, not the newline. A chained
> script like `stage:sync && clasp push` reports **success** having deployed nothing, and any
> future CI step would do the same. A5 was therefore not treated as finished by a push that
> appeared to work — the remote was re-read and diffed against `dist/sync/`, which is what this
> step's proof ("push, then a fresh pull matches") always meant. That check was done by hand
> until **A10 made it mechanical** — [`verify-push.mjs`](../../todoist/ts/scripts/verify-push.mjs)
> now runs inside both `push:*` scripts, so this trap cannot go unnoticed again.

**`push:log` was blocked, deliberately**, until A9 — which is now done. The bound webhook had no Script ID and no
manifest, and `prepare-legacy` refused rather than inventing one. That refusal was vindicated —
see below.

### A9: the event-log webhook

**Pushed and verified on 2026-09-14.** The remote was re-read afterwards: `apps-script` and
`appsscript` both match `dist/log/` byte-for-byte, no stale files were left behind, and the old
`app-script` name is gone. The Script ID was captured the day before and the project read back
through the Apps Script API before anything was staged — the record of that pre-push diff:

| Check | Result |
| --- | --- |
| **Manifest** | **Byte-identical to live** (211 bytes both sides, no trailing newline). No `--force` needed, and no repeat of [the manifest trap](#the-manifest-trap-that-stopped-the-first-push) |
| **Files** | Live holds exactly two — the manifest and one `SERVER_JS`. **Nothing in the editor is missing from the repo**, so a push deletes nothing |
| **Content** | Differs, but **provably only in formatting** — see below |

**Guessing the manifest would have been a real mistake.** It is not the minimal three-key file
the standalone projects carry; it has a `webapp` block:

```json
"webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
```

`ANYONE_ANONYMOUS` is what lets an Apple Shortcut POST without a Google session. A hand-written
manifest omitting it, or defaulting to `ANYONE`/`MYSELF`, would break every Shortcut that logs
an event — silently, since a Shortcut shows no error the phone surfaces.

**The code difference is prettier, and only prettier.** The repo copy is tab-indented and the
live copy is 2-space; comparing token streams rather than bytes, the two are identical apart
from **5 trailing commas** prettier added inside call arguments. Trailing commas in calls are
ES2017 and the project runs V8, so they parse. `doPost`, `doGet`, the `SHEET_NAME` constant and
the five-column `appendRow` are unchanged.

> **The push will rename the editor's file**, as A5's did. Live it is `app-script`; the repo
> file is `apps-script.gs`, so it lands as `apps-script`. Content is unaffected.
>
> ⚠️ **A push changes the code, not necessarily what the URL serves.** A Web App deployment
> pinned to a numbered version keeps serving that version until a new one is deployed; only a
> deployment tracking `HEAD` (the `/dev` test URL) changes immediately. So after pushing, check
> *Deploy → Manage deployments* to see whether the Shortcuts' URL actually picks this up — and
> if it does need a redeploy, that is a second deliberate action, not a side effect of `push`.

### B1: what the seven ports settled

Writing the interfaces against the ten legacy `.gs` turned up things the plan's one-line list
could not have: **the planned six ports do not cover what the code actually does.**

| Platform call | Where it lands | Why it had nowhere to go |
| --- | --- | --- |
| `Utilities.getUuid()` | **`IdGenerator`**, a seventh port | Todoist's `/sync` needs a client-generated uuid per command and uses it for **idempotency** — replaying a command with the same uuid is a no-op. It is the only write path to Todoist, so that key is what stands between a retried run and a double reschedule. It fits none of the six |
| `Utilities.sleep()` | **`Clock.sleep()`** | The paginator waits 300 ms between pages and the Completions windower 400 ms between windows, both to stay clear of Todoist's per-token rate limit. It belongs with the clock because it is the other consumer of wall time — and because a fake must *record* a sleep rather than perform one, or the suite pays for it |

Three further decisions the interfaces encode, each of which could have gone the other way:

- **A non-2xx response is returned, never thrown.** The legacy code passes
  `muteHttpExceptions: true` and inspects the status itself, because Todoist answers a
  rate-limit with 429 *and a body worth reading*. A transport that threw would destroy that body.
  So `HttpResponse` is `{ status, body }` and a throw means the request could not be made at all.
- **`TableStore` is row-oriented, not range-oriented.** No A1 notation and no 1-based column
  arithmetic crosses the seam: `getRange(2, 1, n, m)` is an Apps Script detail that means nothing
  to the Sheets API adapter, and off-by-one errors in it are exactly what should not be ported.
  `deleteRows` is kept separate from `writeRows` precisely because deletion *shifts* everything
  below it — the one operation here that can corrupt a tab wholesale from stale indices.
- **A cell is not a string.** `CellValue` is `string | number | boolean | Date | null`, because
  that is what a sheet hands back. Flattening a date cell to a string is how a column stops
  charting in Looker.

**`ensureTable` is what creates the `*_port` tabs.** The plan noted nothing creates them; it is
now a named responsibility, and specified as idempotent so a pipeline can call it every run.

> **A preview of B6, and a warning for it.** No file in `src/` names a Google global in *code*
> — but six of them name one in a *comment*, explaining what the port replaces. A naive
> `grep`-based layering test would fail on its own documentation. B6 must strip comments before
> it checks, or it will be deleted by the first person it annoys.

### B2: what the three verbs cost

Mapping the eight strategies in [`todoist/README.md`](../../todoist/README.md) onto three verbs
worked, but only after two corrections the design had not anticipated. Both came from reading
the legacy code rather than the plan.

**1. `Match` needed a third case.** `BillCycle` is a **full rebuild** — every data row is
recomputed from `Completions` plus the live task list every night — and neither `equals` nor
`onOrAfter` expresses "all of them". Without `{ all: true }`, `BillCycle` would have kept a
hand-rolled fourth strategy, which is the exact outcome the three-verb model exists to prevent.

**2. Clearing is not deleting, and the difference is load-bearing.** Both
`todoist-bill-cycle.gs` and `todoist-habit-daily.gs` carry a comment explaining that they use
`clearContent()` rather than `deleteRows()`, because **Sheets refuses to delete every unfrozen
row** once the header is frozen — *"No puedes borrar todas las filas móviles"* — which it is the
moment anyone freezes it by hand or converts the tab to a table. Both hit this in production.
`TableStore` therefore gained `clearRowsFrom()`, and the applier clears and then writes at the
same row, because clearing leaves the blank rows in place for the rewrite to land on.

**The resolver refuses rather than guessing.** `replaceWhere` requires its matching rows to form
a contiguous block at the *bottom* of the tab — which they always are, since every tab is
appended in day order, and which the legacy code silently assumes. If that assumption is false
the tab has been sorted or hand-edited, and clearing to the end would destroy rows nobody asked
to touch. For `TaskDaily` and `AreaDaily` those rows cannot be re-fetched from anywhere, so it
throws instead. That is the single most valuable test in the file.

**Where the applier lives is a deliberate exception to the naming rule.**
[`apply-write-plan.ts`](../../todoist/ts/src/core/apply-write-plan.ts) sits in `core/` even
though the rule puts `apply` in `adapters/`. It reaches the outside world *only* through port
interfaces and names no platform global, so it is byte-identical under Apps Script and Node;
duplicating the trickiest ordering logic in the codebase into both adapters would be worse. The
B6 test bans platform globals, which this satisfies — the rule is about platform coupling, and
this has none.

**Dry-run arrived early.** It was scheduled for B4c, but the applier is where it belongs and it
is four lines there, so it exists and is tested now. The cheapest safety rail is available
before anything can write.

### B3: what the adapters proved

The adapters are where the design meets the platform, and three things only became visible here.

**The clear-then-write contract is real, and now tested end to end.** `resolveWriteOperation`
emits `clearFrom(n)` followed by `write(n)` — *the same row* — which is only correct because
`clearContent()` blanks cells and leaves the rows in place. Had clearing removed rows, every
`replaceWhere` would have written into a gap and corrupted its tab. Unit tests on either side
could not catch that; the integration test in
[`gas-integration.test.ts`](../../todoist/ts/src/adapters/gas/gas-integration.test.ts) applies a
real plan through the real adapter and does.

**`clearRowsFrom` clears the full column width, not the populated one.** A stale value parked
beyond the current data would survive a narrower clear and reappear as a ghost cell on the next
whole-tab read — and `getDataRange()` reads the whole tab. It uses `getMaxColumns()` for that
reason.

**`CacheService` fails silently above 100KB** — the put is dropped and every later read misses,
for ever. That is a performance bug with no symptom, and it is why the live task map was never
cached. The adapter measures the value and throws instead, **counting UTF-8 bytes rather than
characters**, because project names carry emoji (`💼 Work`) at four bytes each and a character
count would wave through a value four times over the limit.

Smaller decisions worth having written down:

| Decision | Why |
| --- | --- |
| Every adapter takes its API as an argument | The globals are then named in **one** file (`gas-runtime.ts`), and everything else in `adapters/gas/` is testable under plain Node with a fake. That is the difference between "the adapter compiles" and "the adapter writes to the right cells" |
| Structural types instead of `@types/google-apps-script` | No dependency, and the platform's blast radius is one readable file listing only the methods actually called |
| The globals are read off `globalThis`, not declared ambiently | Under Node they are simply undefined, so `createGasRuntime()` fails immediately and legibly rather than throwing "SpreadsheetApp is not defined" from inside a pipeline |
| `openById` once per run, sheets cached | It is a network call in disguise; the legacy code pays for it 16 times in a single nightly run |
| Writing to a tab that does not exist **throws** | A typo in a tab name must not quietly create a second, empty tab. `ensureTable` is the only thing that creates one |
| `readRows` asks `getLastRow()` first | `getDataRange()` on a brand-new sheet returns `[[""]]` — one blank cell — which would otherwise become a phantom row |

> ⚠️ **A trap for B6.** The layering test cannot simply grep for the platform names. Our own
> port is called `Logger`, which is also the name of the Apps Script global, so a naive check
> flags `ports/logger.ts` and every file importing it. It must match the global's *use as a
> value* (`Logger.log(`) rather than the bare word — and, as noted at B1, strip comments first,
> since six files name a global while explaining what replaced it.

### B4: the first TypeScript in production

The bundle is live. The push added one file and changed nothing else, which is the least
alarming shape a first deployment can have.

| Check | Result |
| --- | --- |
| Pre-push diff | 11 remote files, 12 staged: **one NEW**, zero changed, zero deleted |
| After the push | 12 files live — **10/10 legacy `.gs` still present**, plus the bundle and the manifest |
| `verify:sync` | Ran automatically inside `push:sync` (A10) and reported 12/12 matching, no stale files |
| Bundle | 11.3 KB, unminified, ES2019, one global namespace plus one `port*` function |

**The build runs the bundle before it writes it.** `npm run build` evaluates the real output in
a `node:vm` sandbox with stand-ins for the Google globals, asserts every generated global is
actually a function, and invokes the diagnostics. Typechecking proves the *source* is sound;
this proves the *artifact* is. An ES2019 violation, a footer naming something the IIFE never
exported, or an error on the first line would all surface seconds after a build rather than in
the executions dashboard after a push. The sandbox's `SpreadsheetApp` and `UrlFetchApp` throw on
any use, so a smoke test that quietly reached for a sheet would fail rather than pass hollowly —
and the file is written **only after the check passes**, so a broken bundle never sits in
`dist/` waiting to be pushed.

**Why the bundle is not minified.** The editor is where this gets debugged, there is no source
map, and the whole thing is 11 KB. Minifying would save nothing that matters and cost every
future stack trace.

**The `port` prefix is applied by the build, not typed by hand.** The registry stores the name
each entry point will have *after* cutover (`ping`, later `syncTodoist`), and `globalNameFor()`
derives `portPing` / `portSyncTodoist`. Dropping the prefix at E4 is therefore a one-line change
in one file, not a rename across eleven. The build **throws if two entries would generate the
same global**, since in one flat scope the later definition silently wins — the exact bug the
scheme exists to prevent.

**The seam leaked once, and the check caught it.** The first version of the entry-point module
read `PropertiesService` directly to fetch the spreadsheet id — a Google global outside
`src/adapters/gas/`, which is the one rule B6 exists to enforce. The fix was a
`createGasSettingLookup()` in the adapter, and it is a useful precedent: config has to be read
*before* a runtime exists, so that lookup needs its own door through the seam rather than an
exception to it.

**What is deployed can do nothing.** `portPing()` reads the clock and writes two log lines. It
opens no spreadsheet, reads no property and makes no request. The guards that will let later
entry points write safely are B4b, and they land before any pipeline does.

**The link a push could not prove — that Apps Script would actually *run* it — is now proven.**
`portPing` executed in the editor on 2026-09-14 at 22:46 local, logged both expected lines and
completed with no error. The chain holds end to end: TypeScript → esbuild → generated footer →
`clasp push` → an Apps Script global → a successful execution.

That run also settled something quietly. `createRuntime()` reads `TODOIST_SPREADSHEET_ID`
through `requireSetting` **before** the entry point body runs, and `requireSetting` throws on a
missing or empty value. The execution completing therefore confirms the Script Property exists
and is populated — which every later entry point depends on, and which nothing had checked.

### B4b: two rails, and the hole between them

The guards are decorators rather than checks inside the GAS adapters. A guard baked into the
only implementation cannot be tested apart from it, and the Node adapter (F2) needs exactly the
same protection without a second copy of it.

**Reads are unrestricted, and that asymmetry is the design.** The port *must* read what the
legacy code wrote — `HabitDaily` is rebuilt from `Completions` and `RecurringStatus`, and the
Completions cursor has to be read before it can be continued. Reading is harmless; writing is
what cannot be undone. A guard that blocked reads would simply make the port unable to work.

**The hole the tests found: a dry run bypassed both guards.** The store guards fire when a write
is *attempted* — and a dry run never attempts one. So a dry run against `TaskDaily` printed a
tidy list of operations and exited zero, reporting the plan as safe when running it for real
would have been refused. **A rail that only works when you are not looking is worse than none**,
because it teaches false confidence about the single most dangerous tab in the system.

The fix is `assertPlanIsAllowed`, which the applier runs **first, every time, dry run or not**.
The two layers are now defence in depth: the plan check catches a bad plan before anything is
read, and the store guards catch anything that reaches a store without going through the
applier. Both default closed, and both take their escape hatch as an explicit `=== true`
argument at the call site — never from config, because a rail a stale Script Property can switch
off is not a rail.

| Rail | Fires when | Catches |
| --- | --- | --- |
| `assertPlanIsAllowed` (applier) | Before any read or write, dry run included | A plan built with a legacy tab name or a bare state key |
| `guardTableStore` / `guardKeyValueStore` | At the moment of the call | Anything writing a store directly, without an applier |

Smaller things worth having pinned by a test: the `_port` suffix and `PORT_` prefix are
**case-sensitive** (`Overdue_PORT` is refused); a tab merely *containing* `_port` is not a
shadow tab; and a **truthy-but-not-`true`** flag — the string `"yes"`, say, arriving from config
— does not open the gate.

### B4c: a dry run you can actually reach

The applier could already log instead of apply, and B4b made it refuse a bad plan whether or not
it was dry. What was missing was a way to **ask for a dry run from the editor**, where the Run
button calls a zero-argument global and can pass nothing.

So the build generates a twin. Any entry point declaring `writes` gets both
`portSyncOverdue()` and `portSyncOverdueDryRun()`, the second sitting immediately beneath the
first in the function dropdown. That placement is the point: the plan's standing rule is *never
use the Run button on a port function*, and a rule is followed when the safe option is the
nearer one, not when it is written down somewhere.

A dry run is **not** free of I/O, which is worth knowing before relying on it: it still **reads**
each tab to work out what it would change. It performs no write, creates no tab and persists no
state — but it is not inert, and it cannot run without a real spreadsheet.

**`pingWrite` is the first entry point that writes anything**, and it is deliberately the
smallest possible one: one row appended to `Ping_port`, creating the tab if missing. It exercises
the whole chain Phase D will lean on — a pure plan, the guards, the applier, the GAS
`TableStore` — on a shadow tab no legacy code or Looker source reads. Safe to delete; the next
run recreates it.

> **The build's sandbox caught a mistake of mine immediately.** The self-check invoked every
> entry point of kind `diagnostic`, and `pingWrite` is a diagnostic that writes — so it hit the
> sandbox's throwing `SpreadsheetApp` and failed the build. The fix was to filter on **declared
> `writes`** rather than on `kind`: `kind` says how a thing is invoked, `writes` says what it
> touches, and only the second is a safety question. A dry run would not have been safe there
> either, for the reason above.

### B5: the bill for a synchronous seam

Writing the Node side made the cost of one early decision concrete. The ports are
**synchronous** because an Apps Script trigger cannot `await` — a rejected promise never reaches
the executions dashboard, so a failed nightly run would report success. On the Apps Script side
that was free: `UrlFetchApp` is synchronous already. **Node is where the bill lands**, and it is
not small.

`Clock.sleep` was solvable: `Atomics.wait` on a `SharedArrayBuffer` blocks the calling thread
outright, which is exactly `Utilities.sleep`'s semantics. Blocking a thread is normally a
mistake; here it *is* the contract, and the only callers are two courtesy delays whose whole
purpose is for nothing to happen for a moment.

**`HttpTransport` is the hard one**, and it is now documented in the stub rather than left to be
discovered in Phase F. Node has no synchronous HTTP client. Three ways out:

| Option | Verdict |
| --- | --- |
| `execFileSync("curl", …)` | **My inclination.** Genuinely synchronous, no dependency, trivially debuggable — you can paste the command into a shell. Costs a process per request, irrelevant for tens of calls a night. Needs the token passed by header file or stdin, **never argv**, where it would show in the process list |
| A worker thread + `Atomics.wait` | The "proper" answer, at real complexity: serialising a response through a `SharedArrayBuffer` deserves its own tests |
| Relax the contract to async | **The option to resist.** Every pipeline above the seam would become async — precisely what the ban exists to prevent — and the runtimes would stop sharing the code that matters |

Two things the stubs record for F2 while they are fresh: `clearRowsFrom` must be a `values.clear`
and **not** a `deleteDimension`, for the same reason the legacy code learned it; and the Sheets
API hands a date back as a serial number unless asked otherwise, which `CellValue` admits a
`Date` specifically to avoid.

**A `_State` tab is not the same drawer as Script Properties.** Moving a sync from Apps Script to
a runner therefore needs the cursor copied across as a deliberate migration step — otherwise it
is discovered later, as a gap in `Completions`.

**The Node adapters cost the Apps Script bundle nothing.** esbuild reaches them from no GAS
entry point, so they are tree-shaken out entirely: the only occurrence of `createNodeRuntime` in
`port-bundle.gs` is inside an error message telling you to use it instead.

### B6: a test that can actually fail

The architecture rests on one sentence — a platform global may only be named inside its adapter
— and sentences in design documents decay. This does not.

It checks four things rather than the one the plan specified:

1. No Google global used outside `src/adapters/gas/`.
2. No Node built-in imported outside `src/adapters/node/` (tests exempt). The mirror image
   matters just as much: `node:fs` in a pipeline would break the Apps Script side, which has no
   module system at all.
3. `core/`, `services/` and `pipelines/` import no adapter. The rule stated as a **dependency
   direction** rather than a word list — if `core/` knows adapters exist, the "pure" claim is
   already false whatever the globals say.
4. The detector fires. A layering test that cannot fail is worse than none, because it reports
   success for ever while the thing it guards rots.

**Both traps flagged at B1 and B3 were real**, and the test handles them: it strips comments and
string literals before looking (several files name a global while explaining what replaced it,
and a test that fails on its own documentation gets deleted by the first person it annoys), and
it matches the globals **by use** — `Logger.log(` — rather than by name, because our own port is
also called `Logger`.

> **Verified by mutation, not by assertion.** Adding `SpreadsheetApp.openById()` to
> `core/row.ts` made the suite fail with `core/row.ts: SpreadsheetApp`; restoring the file made
> it pass. A guard nobody has ever seen fail is a guard nobody should trust.

### C1–C4: what porting the core surfaced

The pure core is a faithful port, not a rewrite. Everything below came out of reading the ten
`.gs` files rather than from designing afresh — which is the point: the legacy comments are the
most valuable prose in the repo, and several encode bugs that were paid for once already.

**I introduced a parity bug and caught it by re-reading the source.** I had written
`nextOnTimeCloseStreak` so an `overdue` cycle breaks the streak — which I still think is the
better rule, since a cycle eleven days past due is a failure in progress and carrying the streak
flatters it. **The legacy carries it**, on the stated grounds that "an unfinished cycle is not
yet a failure, exactly as a day in progress is not". Reverted to match.

> **Parity is the bar until Phase E.** The port must reproduce the legacy number before it is
> allowed to improve on it — otherwise E3's tab-by-tab diff cannot tell a deliberate fix from an
> accidental regression, and every disagreement becomes an investigation. Improvements are logged
> for after cutover, not smuggled in during it.

**Three traps that are all the same trap**, and worth stating once: a bare `YYYY-MM-DD` has no
timezone, so constructing a `Date` from it and reading it back through a UTC-behind zone shifts
it a day.

| Where | What it would do |
| --- | --- |
| `isRestDay` | Report every Saturday as a Friday — so every weekend scores as `missed` |
| `clockTimeOf` on a bare due date | Report a due time of 18:00 the day before |
| `formatUtcDay` on an evening instant | File the 20:00 event under tomorrow — the 2026-08-20 bug |

The first two are avoided by staying in UTC (a calendar string's weekday is timezone-free) and
the third by taking the timezone as an argument. They pull in opposite directions, which is
exactly why both formatters still exist and why the local one now names its zone.

**The distinctions the types now carry**, each of which was previously a `""` doing double duty:

- **`toNumberOrZero` vs `toNumberOrNull`.** A blank karma cell should sum as zero; a missing
  estimate must stay absent, because "no estimate" and "estimated at zero" average differently.
  `AreaDaily` carries `counts_observed` for the same reason.
- **`was_overdue` stays three-state.** `"TRUE"` / `"FALSE"` / blank — collapsing blank to false
  would quietly score every unverifiable row as on time.
- **`daysBetweenDays` returns `null`, not `NaN`.** One `NaN` in a running total blanks a column.

**The dedup key is the highest-consequence comparison in the project.** A recurring task reuses
the SAME `task_id` every time it is checked off — only the timestamp differs — so deduping on id
alone keeps the first completion of "Drink Water" and discards every one after it, making the
entire history of every habit invisible. The key carries both, the separator is a `|` because a
hyphen and a colon both occur inside ISO timestamps, and both halves are stringified because a
task id arrives as a number from the API and a string from a sheet.

**Two rules whose ORDER is load-bearing**, and which a careless port would flip:

1. `habitDayStatus` tests `wasCompleted` **before** `isRestDay`, so a weekend check-off counts.
   Testing the rest day first would silently discard it.
2. `billCycleStatus` trusts Todoist's `was_overdue` **before** the dates, because the flag is
   timestamp-precise and the dates are only day-precise. They legitimately disagree on a same-day
   close.

### D1–D2: the first real pipeline

The sandwich works, and the entry point is the evidence. `runPortSyncOverdue` is about twenty
lines: fetch two endpoints, call one pure function, apply the plan. **Every decision — which
rows, which day to replace, what to log — happens in `planOverdue`, which touches nothing and is
tested against fixtures.** That is the shape every remaining pipeline follows.

**An eighth port appeared, and it was unavoidable.** The pipelines need the Todoist token and
the timezone, and config crosses the seam exactly like everything else: Script Properties under
Apps Script, environment variables under a runner. `SettingLookup` is now part of `Runtime`. It
is a bare function rather than an interface because there is one operation and both platforms
already expose that shape — and `requireSetting` above it is what keeps the fail-closed rule.

**Three rules the service layer encodes, all of them bought with past incidents:**

| Rule | Why |
| --- | --- |
| `limit=50` is a CAP, not a preference | The completed-tasks endpoint silently CLAMPS higher values on some accounts, so pages look complete when they are not — the worst failure mode for an append-only tab |
| An EMPTY page stops the loop, cursor or no cursor | Some endpoints hand out a cursor indefinitely with nothing in the batch (observed on `/activities`); trusting it runs until the 6-minute cap |
| A failed page THROWS | Returning what arrived so far looks like a short list rather than a broken call — and silently loses history |

**The 429 message names the cause you will actually have.** Phase E runs two implementations
against one token and the limit is per token, so the error says so rather than making you
rediscover it at 23:30.

**`days_overdue` is where the timezone work pays off.** The legacy comment records that a UTC
stamp labelled every nightly snapshot with the NEXT day and inflated `days_overdue` by one **for
months**. `planOverdue` takes `today` as an argument, so a test asserts the number directly at
two different days — the drift is now visible in a test rather than in a chart a season later.

**A day with nothing overdue still writes a plan.** A naive "skip when empty" would leave
yesterday's snapshot looking like today's, and clearing your last overdue task would show it
still overdue for ever. The empty `replaceWhere` is the point, not an oversight.

> **One tidy-up worth naming.** I left a `shouldStopPaging` helper in `responses.ts` that
> duplicated the rule the fetcher already implements — two sources of truth for the one thing in
> this layer that must not drift. Deleted rather than wired up.

### D3–D5: three more pipelines, and a real bug

**A test caught a defect that would have corrupted the one irreplaceable tab.** The dedup key
stringified whatever the sheet returned — and Sheets hands back a real `Date` once a cell is
date-formatted. `String(aDate)` is `"Sun Sep 14 2026 07:02:00 GMT-0600"`, which matches no ISO
string ever written, so **every completion would have failed to dedup and re-appended on every
run**, silently, in the tab whose rows cannot be re-fetched.

`canonicalInstant` now normalises both sides to the same moment, which also makes
`2026-09-14T13:02:00Z` and `…:00.000Z` one key — the API omits milliseconds and a round-tripped
cell adds them. A bare `2026-09-14` is deliberately left alone: a day is not an instant, and
promoting it to midnight UTC would invent a time it never had.

> The legacy code has the same fragility — it builds its key with a bare `String(r[0])` — and
> gets away with it only because column A happens to hold text today. **The fix changes no
> output**, because dedup keys live in memory and are never written, so parity is untouched.

**Completions carries state, and the ordering is the whole design.** Two keys — the cursor and
the In Review membership — both written only AFTER the rows land, which `applyWritePlan`
guarantees. Advancing either before the write means the next run starts past completions that
were never recorded: a permanent hole rather than a retryable failure.

**The window decision got its own module**, because it is the thing most likely to be wrong
invisibly. A window too SHORT loses history; one too LONG is rejected outright by the API's
three-month limit. Four cases, each tested:

| Case | Window | Why |
| --- | --- | --- |
| Usable cursor | `[cursor, now]` | The normal path |
| **Empty tab** | Full 90 days, cursor ignored | Lets you clear the tab by hand and have it refill. Trusting the cursor here would fetch a few hours, write four rows, and leave four years gone |
| Cursor > 90 days old | Clamped | The API hard-errors above the span, so an un-clamped window fetches **nothing** |
| Cursor in the FUTURE | Full 90 days | Clock skew or a hand-edited property. `[future, now]` is an empty window that records zero every night while the cursor keeps advancing — invisible for ever |

**In Review is a STATE, not an event**, and the entered-since diff is what makes it usable as
one. The baseline persists **everything** currently there, not just the new ones: persisting
only the new would make every unchanged task look new next run and re-record it nightly. Absent
or malformed state reads as an empty set, so the next run treats everything as new — a one-time
over-count rather than a silent under-count, which is the right way round, because a duplicate
row is visible and removable and a missing one is neither.

**Two normalisation traps in the activity source**, both carried across from hard-won comments:
the project is at the top level as `parent_project_id` rather than in `extra_data`, and
`due_date` is already the NEXT occurrence — the completed one is `completed_due_date`. Reading
`due_date` would date every recurring completion one cycle into the future.

**KarmaStats' re-run case** is the kind of bug that reads as data rather than as a fault: without
excluding today's own row, a second run of the same day computes the delta against the row it is
about to overwrite and always reports **0**, which looks like "no karma earned today".

> **One tidy-up.** I had re-declared the cursor key as a local constant in `registry.ts` rather
> than importing it — two sources of truth for a string that must match exactly, which is
> precisely how a cursor silently stops being read. Now imported from the pipeline that owns it.

### D6–D9: the derived tabs

These read the tabs the fetch pipelines wrote rather than Todoist, which makes the orchestrator's
[ordering invariant](#the-orchestrators-ordering-invariant) load-bearing rather than tidy.

**A decision worth stating: the derived pipelines read the `*_port` tabs, not the legacy ones.**
Reading `Completions` would compare the port's derivation of the LEGACY data against the
legacy's own — which tests the derivation but says nothing about the pipeline feeding it. Reading
`Completions_port` makes Phase E's diff an end-to-end check of the whole chain. The cost is that
a derived tab is only as good as the fetch pipeline above it, which is the right dependency to
have.

**Three failure modes, all silent, all now pinned by a test:**

| Tab | The mistake | What it would do |
| --- | --- | --- |
| TaskDaily | Reading prior state from today rather than **strictly before** | An hourly re-run reads its own half-written rows and resets every section age to zero |
| TaskDaily | Including exit rows in prior state | A task that left last week is resurrected as a fresh exit row **every night, for ever** |
| HabitDaily | Letting the replace boundary reach below the observed spine | A 400-day rebuild DELETES synthesised pre-spine rows while writing nothing in their place |

**"A floor stays a floor."** TaskDaily's `section_age_seeded` marks a date that is a lower bound
rather than an observation — the task was already somewhere when we first looked, and the true
date is unknowable. Carrying that flag forward is what stops a guess quietly becoming a claim on
day two. The four cases are now one tested function.

**`workStageOf` is a rename tripwire, not just a mapper.** `Study/Reading` runs Backlog / In
Progress / Quiz / Done and `Work` runs its own vocabulary; without normalisation "how much work
is in review" cannot be asked across projects. Anything unrecognised becomes `other`, so a
section renamed in Todoist shows up as a **growing `other` bucket** instead of vanishing from
every chart.

**HabitDaily writes nothing when the spine is missing.** The tempting alternative — write what
you can — would clear the grid and refill it with nothing, destroying history to no purpose. A
missing `RecurringStatus` is a reason to stop, not to proceed carefully.

**The `due` column is 1 for everything except `not_due`**, which is what keeps a weekend
check-off visible: doing a habit on a rest day is not nothing, and scoring it as "not owed" would
throw the completion away.

**Two API facts the tests now hold in place**, both easy to invert: Todoist's wire priority **4**
is the UI's **p1** (an off-by-three waiting to happen), and a Completions row's `was_overdue` is
three-state — blank is UNKNOWN, and collapsing it to FALSE would score every unverifiable cycle
as closed on time.

### D11–D12: the two write paths

Both of these write something the shadow-tab scheme cannot cover, and they fail differently from
everything else in the port, so they are shaped differently.

**The reschedule is the only write path to Todoist, and THERE IS NO SHADOW TODOIST.** Every other
pipeline writes `X_port` and a mistake costs a scratch tab; this one moves real tasks in the app
you plan your day with. The B4b guards are irrelevant here — they check tab names and state keys,
neither of which is involved.

So the safety model is different: the decision is a **pure function returning a list of
commands**, and issuing them is a separate step. Reading exactly what a run would send is always
possible without sending it, and the log names every task and its target date **before** anything
goes out.

That needed one addition to the registry: a `writesExternally` flag. The dry-run twin was
generated from `writes`, which lists TABS — so the one entry point that most needs a dry run
would have been the only one without one. `portRescheduleHabitsDryRun` now exists.

**It stays manual, with no trigger, ever.** A scheduled job that silently moves tasks in the app
you plan your day with is a categorically different thing from one that writes a spreadsheet.

Three rules the tests pin, each of which the legacy learned by getting it wrong:

| Rule | What goes wrong without it |
| --- | --- |
| A habit and its sub-habits move as **one unit** | Judged individually they go stale on different clocks — the parent bumps once the grace window passes, its date-only steps not until the day flips. The steps sit a day behind their own routine and read as skipped that night |
| A **healthy parent still drags a straggling step** forward | Do the routine but leave one box unchecked: Todoist rolls the parent forward on completion while the step stays put. Nothing else would ever touch it, and it stays overdue indefinitely |
| **Undated steps are left alone** | Giving them a date silently opts them into the Overdue snapshot |

**A timezone trap I had to handle explicitly.** Todoist sends a floating `…T07:00:00` with no
offset, meaning 07:00 LOCAL. Parsing it directly reads it as UTC — which in a UTC-6 zone makes
every morning habit look six hours more stale than it is, bumping routines that were only just
missed. The offset is now derived from the zone at that instant rather than assumed, so it stays
correct if a zone ever reintroduces DST.

**The webhook never throws.** It is the port's only INBOUND path, and its caller is a phone that
will not retry: a thrown error reaches a Shortcut as an opaque failure and the event is simply
lost. It returns a JSON body saying what happened instead. It also accepts both `notes` and
`note` — both spellings exist in Shortcuts in the wild — and **prefers the device's own
timestamp**, because the watch may have been offline when the event happened and overwriting it
would file every queued event at the moment it finally uploaded.

> ⚠️ **D12's logic is ported but NOT deployed.** `event-log` is a separate clasp project and the
> port bundle is not staged into it, so the live webhook still runs the legacy `.gs`. That is
> deliberate: swapping a webhook that Apple Shortcuts POST to changes a URL's behaviour for a
> device that cannot report failure, which is a Phase E decision rather than a Phase D one.

### The first real failure: a 503, and what it cost

The first manual run of `portSyncTaskDaily` died at 01:06 on 2026-09-14:

```
Error: Todoist /projects → HTTP 503:
fetchAllTodoistPages	@ port-bundle.gs:2170
runPortSyncTaskDaily	@ port-bundle.gs:2549
```

Todoist was briefly down. The port did exactly what the legacy does — throw, and lose the run —
and nothing partial was written, because the throw happened during the fetch, before a plan
existed. That part of the design held.

**But it revealed a hole that only matters for one tab.** Most pipelines recompute from live
state, so a lost run costs nothing: the next one produces the same rows. `TaskDaily` is
observed-only. Todoist keeps no record of what was open on a past date, so a run lost to a
thirty-second blip is a **permanent hole no re-run can fill** — and its aging columns read its
own previous day, so the hole propagates into every row after it. A nightly trigger plus an
upstream blip is not a hypothetical; it is a matter of time.

So `services/retry-transport.ts` now wraps the transport in the Apps Script runtime:

| Decision | Why |
| --- | --- |
| Retry **429, 408 and 5xx only** | A 401 is a bad token and a 400 is a bad request. Both are still wrong three seconds later, and retrying spends the 6-minute budget to reach the same error with a worse log |
| **3 attempts**, 1s then 2s, capped at 8s | Every sleep is charged against the same 6-minute cap as the work, and a paged endpoint multiplies it by the page count. This covers a blip; a longer outage is a missed run, and the dashboard should say so |
| **No jitter** | Jitter stops a herd of clients synchronising. There is one client, and an unpredictable delay would make the budget unpredictable too |
| A persistent failure is **returned, not thrown** | `fetchAllTodoistPages` owns the "a failed page is fatal" decision. A decorator that threw would move that decision somewhere nobody looks |
| **POSTs are retried too** | Not generally safe — safe *here* because the only POST is Todoist's `/sync`, and every command carries an idempotency uuid, so a replay is a no-op rather than a second reschedule |
| Applied at the **runtime**, not inside the adapter | Keeps `gas-http.ts` a thin translation of `UrlFetchApp`, and keeps the policy testable under plain Node. The Node transport is deliberately **not** wrapped: it is still the F2 stub, and retrying `notImplemented` three times turns a clear error into a slow one |

**This is not a parity break, but it will show up in the E3 diff.** A run that succeeds produces
byte-identical rows either way; the only difference is how many runs succeed. Since the legacy
has no retry, the port will occasionally survive a blip the legacy does not — appearing in the
diff as the port having a row for a day the legacy missed. Expect it, and read it as the port
being right.

Two smaller things fell out of the same sitting:

- The root `format:ts` glob still said `ts/**/*.ts`, a path that stopped existing at the
  "one top-level directory per integration" restructure. **Prettier had been matching nothing**
  since, and `npm run format` was silently a `.gs`-only command. Now points at `todoist/ts/`.
- Writing the decorator's loop, the first version re-issued the request after the last attempt to
  produce a return value — `maxAttempts + 1` calls and a doubled final delay. There is a test
  named for it.

## Definition of done

The port is finished when all of these are true. Written down because "ported" is otherwise a
feeling, and because several are easy to skip and only notice a year later.

| # | Done means | Checked by |
| --- | --- | --- |
| 1 | Every tab the legacy code wrote is written by a TypeScript pipeline, with matching output | E3's tab-by-tab diff |
| 2 | No Google global is named outside `src/adapters/gas/` | The B6 layering test, in `npm test` |
| 3 | Every callable is in the registry, and `ENTRYPOINTS.md` matches it | A test asserts the file matches the array |
| 4 | The header constants match the schema docs | The schema-parity tripwire (Doc upkeep #5) |
| 5 | The three legacy triggers are gone and their port equivalents run on schedule | The executions dashboard, over a week |
| 6 | A failed run still surfaces in the executions dashboard | The async ban — a rejected promise would silently pass |
| 7 | `docs/todoist/architecture.md` describes `todoist/ts/`, not the `.gs` | E6 |
| 8 | The legacy `.gs` are frozen with a header saying so, and still in the repo | E5 |

Phase F is **not** part of this. The port is done when Apps Script runs TypeScript; moving to
GitHub Actions is a separate goal that the architecture makes possible rather than requires.

## Open questions

- ✅ **~~One Apps Script project or two?~~ Settled by the A3 pull: it is already two.** Todoist
  Sync and Everhour Sync are separate projects with separate scopes and separate Script
  Properties — the docs describing one shared `quantified-self-sync` were simply wrong. The port
  keeps them apart. Since superseded anyway: Everhour has been deleted, so only the Todoist
  project is ported.
- 🔶 **Does the reschedule move to Actions?** It is the only write path to Todoist and is
  deliberately manual. `workflow_dispatch` gives it an audit log; leaving it in Apps Script
  keeps the one destructive path behind a button only you can press.
- 🔶 **Does `_State` belong in the data spreadsheet or its own?** A `_State` tab is simplest,
  but it puts cursor state one accidental sort away from the data it guards.
- 🔶 **Do the ~20 backfill/repair/diagnostic functions all get ported?** Several were written
  for a one-time migration that has already happened. Porting them costs real effort; deleting
  them loses a recovery tool. My inclination is to port the diagnostics, and leave the one-shot
  repairs in the frozen `.gs` where they still run if ever needed.

---

## Changelog

How this plan's picture of the system has changed. Useful when an older statement elsewhere
seems to contradict the current one.

| Then | Now |
| --- | --- |
| 7 files, 111 globals in "the sync project" | **Two separate projects**, confirmed by the A3 pull: *Quantified Self - Todoist Sync* (10 files, 146 globals) and *Quantified Self - Everhour Sync* (1 file, 19 globals). 4,710 lines in total |
| 5 tabs, `BoardDaily` pending | **8 tabs** — `BillCycle`, `AreaDaily`, `TaskDaily` landed with the life-areas work |
| Orchestrator ran 5 steps | **8 steps**, with a documented ordering constraint between them |
| "the editor may be ahead of the repo" | **Neither, almost.** The A3 pull settled it: 9 of 11 files byte-identical, one editor-only comment, one editor-only duplicate function. Nothing would be lost by a push |
| [`life-areas.md`](life-areas.md): "nothing is deployed" | **Wrong on both counts, and now corrected.** All four life-areas files are live and identical to the repo (A3), and the three tabs plus the `Completions` area columns exist (A6, 2026-09-13). What actually remains there is Phase 4, the Looker pages |
| `sheets/` held every integration | **Restructured.** Three integrations at top level — `todoist/`, `health/`, `event-log/` — plus `trackingtime/` (unbuilt). The port workspace and the Looker specs moved *inside* `todoist/`, as `todoist/ts/` and `todoist/looker/`; `shortcuts/` moved into `event-log/`. Everhour was **deleted entirely**, code and schema both, and the health webhook was deleted pending a rework |

Adopting clasp is therefore a hygiene win rather than a rescue — the code is already where it
needs to be. **Phase A still goes first**, because it converts "paste eleven files and hope"
into a reviewable, repeatable push, and because A3's diff is the only thing that could have
told us the above.
