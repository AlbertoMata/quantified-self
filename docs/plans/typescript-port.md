# Apps Script → TypeScript port — design

**Status** (2026-09-11): **Phase A nearly done — A1–A5 complete for the Todoist project.**
The legacy `.gs` are deployed by `clasp push` and verified against the remote. The
`todoist/ts/` workspace is green (`npm run typecheck`, `npm test` 6/6, Node running `.ts` with
no build step). No TypeScript has been deployed yet.

The **step list** is the plan of record — ✅ done, ⏳ in progress, 🔶 needs you. Everything
under [Reference](#reference) and [Findings](#findings) is material the steps link back to;
you should not need to read it top to bottom.

## Next actions

In order. **A8 is the only hard blocker** — Phase B writes nothing until B4, but once it does,
that backup is the sole recovery path for the two tabs that cannot be rebuilt. A6 and A9 need
a browser; A9 then needs a terminal with clasp auth. A7 and A10 I can do unattended.

| # | Step | What to do | Why it blocks |
| --- | --- | --- | --- |
| 1 | **A8** 🔶 | `quantified-self-todoist` → File → Make a copy, name it with today's date, then never touch it | The port develops against production. This copy is the only thing that can restore a deleted `TaskDaily` row — see [safety rails](#safety-rails-without-a-second-project) |
| 2 | **A6** 🔶 | Open the spreadsheet and confirm the `BillCycle`, `AreaDaily` and `TaskDaily` tabs exist, and that `Completions` has the `area` / `area_source` / `was_overdue` columns | The life-areas *code* is live (A3 proved it) but nobody has confirmed the tabs are. If they are missing, the nightly run is failing silently |
| 3 | **A9** 🔶 | `quantified-self-log` → Extensions → Apps Script → Project Settings → copy the Script ID | `push:log` cannot run without it, so the event-log webhook is still deployed by paste |
| 4 | **A7** | Docs: paste → `clasp push` | Mostly done incidentally; needs a sweep |
| 5 | **A10** | The `verify:<project>` script | `clasp push` exits 0 when it skips. Until this exists, every push needs a manual re-read |
| 6 | **B1** | The six port interfaces — pure types, touches nothing live | Start of the port proper |

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
| **B** — the seam | The six port interfaces, the GAS adapters, the build, the guards | Only a `portPing()` smoke test |
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
> cheap one — a dated backup copy — is step **A8**.
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
| **A5** ✅ (`sync`) 🔶 (`log`) | [`scripts/prepare-legacy.mjs`](../../todoist/ts/scripts/prepare-legacy.mjs) stages a project's `.gs` set + its manifest into `dist/<project>/`; `stage:*`, `status:*` and `push:*` scripts wired for `sync` and `log`. Legacy stages **unbundled**, one file per `.gs`, so the editor stays diffable file-by-file; bundling starts at B4. **`sync` is pushed and verified.** `log` is still blocked: no Script ID and no manifest ([why](#a5-the-first-push-and-what-it-did)) | **Met for `sync`:** the remote was re-read after the push — 11/11 files match `dist/sync/`, no stale files remain, and the duplicate `localDayOf` is gone (A4 #2). **The re-read is the proof, not the exit code** — `clasp push` exits 0 when it skips |
| **A6** 🔶 | **Verify**, not deploy — the four life-areas files are already live (A3). What remains is whether the three tabs and the Completions area columns exist, per [the documented order](life-areas.md#deploying), and correcting that doc's status | Three new tabs exist; `syncTodoist()` runs green |
| **A7** | `CLAUDE.md`, `README.md`, `docs/sheets.md` updated: paste → `clasp push` | The setup steps no longer mention the editor |
| **A8** 🔶 | **A dated backup copy** of `quantified-self-todoist` — File → Make a copy, named with today's date, then left untouched. No second Apps Script project: the port develops in the production project ([decision](#one-project-what-changes)). This is the only thing standing between a bad `replaceWhere` and unrecoverable `TaskDaily`/`AreaDaily` history | A copy exists, dated, and nothing writes to it |
| **A9** 🔶 | **Unblock `push:log`** — the event-log webhook's Script ID from *Extensions → Apps Script → Project Settings*, then `clasp clone` it into a scratch directory and copy its real `appsscript.json` to `todoist/ts/appsscript/log.json`. Never hand-write that manifest: for a bound Web App it carries `webapp.access` and `executeAs`, so a guess can change who may call the webhook or break the URL the Shortcuts POST to | `status:log` lists files; `push:log` round-trips and a re-read matches |
| **A10** | **`verify:<project>`** — re-reads the remote and diffs it against `dist/<project>/`, failing loudly on any mismatch or leftover file. Wired into `push:*` so a push that deploys nothing cannot report success | Deliberately breaking a staged file makes `verify:sync` fail |

### Phase B — The seam

The interfaces that make everything above them platform-free. No behaviour moves yet.

| Step | What lands | Proof it's done |
| --- | --- | --- |
| **B1** | `src/ports/` — the six interfaces: `HttpTransport`, `TableStore`, `KeyValueStore`, `CacheStore`, `Clock`, `Logger` | `typecheck` passes; no implementation exists yet, by design |
| **B2** | `src/core/write-plan.ts` — `WriteOp`, `WritePlan`, `Match`; and `src/core/row.ts` | Unit tests for the three verbs against an in-memory table |
| **B3** | `src/adapters/gas/` — all six ports implemented over `SpreadsheetApp`, `UrlFetchApp`, `PropertiesService`, `CacheService`, `Session`, `Utilities`, `Logger` | Each adapter has a test using a fake of the GAS global |
| **B4** | esbuild build → **one file**, staged alongside the ten legacy `.gs` in `dist/sync/` because a push replaces the whole project ([why](#one-project-what-changes)). Manifest copied in; IIFE + a generated global footer that **prefixes every entry point with `port`** | A hello-world `portPing()` pushes, runs in the live editor, and **the legacy files are all still present afterwards** — verified by re-reading the remote, not by the exit code |
| **B4b** | **The guards that replace a second project.** There is only one spreadsheet ID now, so a protected-ID list is meaningless. Instead: the `TableStore` refuses any tab name not ending `_port` unless `allowProductionTabs` is explicitly true, and the `KeyValueStore` refuses any key not starting `PORT_` | Tests assert that writing `Overdue` throws while `Overdue_port` succeeds, and that writing `TODOIST_LAST_SYNC` throws while `PORT_TODOIST_LAST_SYNC` succeeds |
| **B4c** | **Dry-run mode** — the applier logs the `WritePlan` instead of applying it | Running any entry point with `dryRun: true` touches no cell and prints every op it would have performed |
| **B5** | `src/adapters/node/` — the same six ports, stubbed to throw `NotImplemented` | The shape exists from day one so Phase F is filling in blanks, not redesigning |
| **B6** | **The layering test** — no file outside `src/adapters/gas/` may name a platform global | `npm test` fails if anyone reaches through the seam |

### Phase C — The pure core

Small, heavily tested, and where the naming rules get established for everything after.

| Step | What lands | Proof it's done |
| --- | --- | --- |
| **C1** | `core/dates.ts` — the duplicate `toDateString` dies here. One `formatUtcDay()`, one `formatDayInTimezone(date, timezone)`, never an ambient timezone | Tests for the UTC-vs-local evening case that [`history.md`](../../todoist/history.md) records as a real 2026-08-20 bug |
| **C2** | `core/labels.ts`, `core/numbers.ts`, `core/keys.ts` — label splitting, `toNumberOrZero`, the composite dedup keys | Tests per function |
| **C3** | `core/habits.ts` — `habitDayStatus`, `nextStreak`, `dueTimeOf`, `isRestDay` | The habits scratchpad harness becomes committed tests |
| **C4** | `core/areas.ts` — area resolution, bill-cycle status | The life-areas harness (114 assertions) becomes committed tests |

### Phase D — One pipeline per step

Each step is a vertical slice: service descriptors, a pure `plan()` function, an entry point,
tests, and the schema-doc parity check. Each is independently reviewable and independently
abandonable.

| Step | Pipeline | Why in this position |
| --- | --- | --- |
| **D1** | `services/todoist/` — request descriptors, response parsers, the pagination step rule | The shared dependency of everything below |
| **D2** | Overdue | Simplest possible shape: one call → one `replaceWhere`. Proves the sandwich |
| **D3** | RecurringStatus | Same shape; it is the spine `HabitDaily` needs |
| **D4** | KarmaStats | Introduces `upsert` and the two-candidate stats endpoint |
| **D5** | Completions + the In Review source | Three sources, a persisted cursor, composite dedup. The hardest fetch pipeline — do it once the shape is proven |
| **D6** | BillCycle | First derived-from-Completions tab |
| **D7** | AreaDaily | Derived + snapshot hybrid, with the `counts_observed` flag |
| **D8** | TaskDaily | **Observed-only, self-referential.** Its aging columns read its own previous day |
| **D9** | HabitDaily | The most logic of any tab; reads two tabs, writes a window |
| ~~**D10**~~ | ~~Everhour~~ — **dropped.** Everhour is retired; see [`../../trackingtime/`](../../trackingtime/README.md). If [TrackingTime](../../trackingtime/README.md) is built by the time Phase D runs, write it here *natively* in the new layers rather than porting anything | No parity bar to clear makes it the easiest possible first native integration |
| **D11** | Reschedule habits | The only write path to Todoist. Ported late, deliberately, and stays manual |
| **D12** | The webhooks | `event-log/apps-script.gs` is tiny but a separate clasp project with its own deploy. The health webhook's code was **deleted pending a rework** — when it returns, write it in these layers rather than porting the old one |

### Phase E — Cutover

| Step | What happens |
| --- | --- |
| **E0** 🔶 | **Take a fresh dated backup copy** of `quantified-self-todoist` and leave it untouched. This is the rollback for everything E does |
| **E1** | `port`-prefixed triggers installed alongside the legacy ones, **offset by 15–30 minutes so the two never run together** ([why](#running-two-implementations-at-once)). Legacy keeps writing the real tabs; the port writes only `*_port` tabs |
| **E2** | Both run for several days — same spreadsheet, **disjoint tab sets**, identical input data and timing |
| **E3** | A diff harness compares `X` against `X_port` for every tab. Row-for-row equality is the bar for `Overdue`, `KarmaStats`, `RecurringStatus`, `HabitDaily`, `BillCycle` |
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
| `ports/` | Six interfaces | The seam itself |
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

export type Match = { equals: string } | { onOrAfter: string };

export interface WritePlan {
    writes: WriteOperation[];
    stateToPersist: Record<string, string>; // written only AFTER the rows land
    logLines: string[];
}
```

`Match` is a predicate rather than a bare equality because `HabitDaily` replaces a trailing
*window*, not one day. Every other tab uses `equals`.

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
irreplaceable data, and it is one menu click.

| Rail | What it is | What it catches |
| --- | --- | --- |
| **A dated backup copy** (A8) | File → Make a copy, named with the date, never written to. Retaken at E0 | The unrecoverable case. Nothing else on this list restores a deleted `TaskDaily` row |
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
| **The life-areas code is already deployed** | All four files — Areas, Area Daily, Bill Cycle, Task Daily — are live and byte-identical to the repo. [`life-areas.md`](life-areas.md) still says "Nothing is deployed / none of it has been pasted into Apps Script yet", which is **stale**. Whether the *tabs* exist is a separate question this pull cannot answer |
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
> step's proof ("push, then a fresh pull matches") always meant. That check is currently done by
> hand; a `verify:<project>` script would make it mechanical, and **B4's push scripts should
> not ship without one**.

**`push:log` is blocked, deliberately.** The bound webhook has no Script ID captured and no
manifest. `prepare-legacy` refuses rather than inventing one: a bound Web App's
`appsscript.json` carries its `webapp.access` and `executeAs` settings, so a guessed manifest
could change who may call the webhook or break the URL the Shortcuts already POST to. Capture
the real one by pulling the project before pushing it.

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
| [`life-areas.md`](life-areas.md): "nothing is deployed" | **Stale.** All four life-areas files are live and identical to the repo. Whether the *tabs* exist is a separate question the pull cannot answer |
| `sheets/` held every integration | **Restructured.** Three integrations at top level — `todoist/`, `health/`, `event-log/` — plus `trackingtime/` (unbuilt). The port workspace and the Looker specs moved *inside* `todoist/`, as `todoist/ts/` and `todoist/looker/`; `shortcuts/` moved into `event-log/`. Everhour was **deleted entirely**, code and schema both, and the health webhook was deleted pending a rework |

Adopting clasp is therefore a hygiene win rather than a rescue — the code is already where it
needs to be. **Phase A still goes first**, because it converts "paste eleven files and hope"
into a reviewable, repeatable push, and because A3's diff is the only thing that could have
told us the above.
