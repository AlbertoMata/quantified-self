# Apps Script → TypeScript port — design

**Status** (2026-09-09): **Phase A in progress — A1, A2, A3 complete; A4 next.**
The `todoist/ts/` workspace is green (`npm run typecheck`, `npm test` 6/6, Node running `.ts`
with no build step). clasp v3.4.1 is authorised, and **both standalone projects have been
pulled and diffed** — see [What the A3 pull found](#what-the-a3-pull-found), which corrected
three facts this plan had wrong.

Every `.gs` file under [`../../todoist/`](../../todoist/) and
[`../../event-log/`](../../event-log/) stays the deployed source of truth and is not edited until
the Phase E cutover. ([`../../health/`](../../health/) has no code — its webhook was deleted
pending a rework.) The **step list** below is the plan of record — ✅ done,
⏳ in progress, 🔶 needs you — and everything after it is reference material the steps point
back to.

## Picking this up in a new session

Everything needed to resume is committed; nothing important lives in a scratchpad. Start here:

1. **Read [What the A3 pull found](#what-the-a3-pull-found)** — it corrected three facts older
   revisions of this plan stated wrongly, and a fresh session will otherwise repeat them.
2. **A4 is next, and it is three decisions rather than code** — see the step's row. All three
   can be answered from a phone; none needs a terminal.
3. **`clasp` auth does not travel.** Credentials live in `~/.clasprc.json` on the machine where
   `clasp login` ran. A5's push, and any re-pull, must happen on a machine that has them —
   a remote or mobile session can do A4, A6's decisions, and any doc work, but not a push.
4. **Script IDs are deliberately not committed** (`.clasp-*.json` is gitignored). Re-find the two
   standalone ones in a single Drive query using the clasp token — that is how A3 found them:

   ```sh
   TOKEN=$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.clasprc.json')))['tokens']['default']['access_token'])")
   curl -s -H "Authorization: Bearer $TOKEN" \
     "https://www.googleapis.com/drive/v3/files?q=mimeType%3D%27application%2Fvnd.google-apps.script%27%20and%20trashed%3Dfalse&fields=files(id,name)"
   ```

   The two bound webhook projects do **not** appear in Drive; their IDs come from each
   spreadsheet's *Extensions → Apps Script → Project Settings*.

## What changed since the last revision

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

> 🔒 **Standing rule for Phases B–E: no port code ever points at `quantified-self-todoist`.**
> Everything is developed against a throwaway copy, from the first line that can write a cell
> until the cutover. The rails that enforce it are in
> [Test spreadsheet and safety rails](#test-spreadsheet-and-safety-rails), and the first of them
> — the copy itself — is step **A8**, before anything in Phase B can run.

### Phase A — clasp, on the code that exists today

No TypeScript yet. This phase ends copy-paste deployment.

| Step | What lands | Proof it's done |
| --- | --- | --- |
| **A1** ✅ | `todoist/ts/` workspace: `package.json`, `tsconfig.json`, `.gitignore`, `README.md`, and `src/config.ts` — the fail-closed settings reader, with tests. Root gains `workspaces`, `typecheck`/`test` delegation, a split `format:gs` / `format:ts`, and a committed lockfile | `npm run typecheck` clean, `npm test` 6/6 green — Node runs `.ts` with no build step, as designed |
| **A2** ✅ | `@google/clasp` (v3.4.1) added, `.clasp.example.json` committed, real `.clasp-*.json` gitignored, `clasp:login` / `clasp:whoami` scripts wired | `clasp:whoami` reports the authorised account |
| **A3** ✅ | `clasp pull` of both standalone projects into the **scratchpad** (never the working tree — pull overwrites), diffed against the repo with formatting normalised | [Report below](#what-the-a3-pull-found): 9/11 files identical, 2 differences, both understood |
| **A4** ⏳🔶 | Manifest **captured** to `todoist/ts/appsscript/todoist.json` (the Everhour one was dropped with the integration). Remaining: [three decisions](#a4-the-three-open-decisions) | `git diff` reviewed by you, then committed by you |
| **A5** | A `prepare-legacy` script that stages each project's `.gs` set + its manifest into `dist/<project>/`, and the two `push:*` scripts (`sync`, `log`) — health has no code to push | `npm -w todoist/ts run push:sync` round-trips: push, then a fresh pull matches |
| **A6** 🔶 | **Verify**, not deploy — the four life-areas files are already live (A3). What remains is whether the three tabs and the Completions area columns exist, per [the documented order](life-areas.md#deploying), and correcting that doc's status | Three new tabs exist; `syncTodoist()` runs green |
| **A7** | `CLAUDE.md`, `README.md`, `docs/sheets.md` updated: paste → `clasp push` | The setup steps no longer mention the editor |
| **A8** 🔶 | **The test spreadsheet and the staging project** — a copy of `quantified-self-todoist` named `quantified-self-todoist-test`, plus a *separate* standalone Apps Script project bound to nothing, with its own Script Properties pointing at the copy | The copy's ID is in the staging project's properties, and the live ID appears nowhere in it |

#### What the A3 pull found

Both standalone projects pulled into the scratchpad and diffed against the repo, with
formatting normalised on both sides so whitespace could not mask content. **9 of 11 files are
byte-identical.** Nothing exists in an editor that is missing from the repo, so a push would
destroy nothing — with one small exception below.

| Finding | Detail |
| --- | --- |
| **There are two standalone projects, not one** | *Quantified Self - Todoist Sync* (10 files) and *Quantified Self - Everhour Sync* (1 file, still named `Código.js`). The docs describe a single `quantified-self-sync` project holding both; that has never been true. This **settled the "one project or two?" open question** — it was already two. Since superseded: Everhour has been retired, so only the Todoist project is ported |
| **The life-areas code is already deployed** | All four files — Areas, Area Daily, Bill Cycle, Task Daily — are live and byte-identical to the repo. [`life-areas.md`](life-areas.md) still says "Nothing is deployed / none of it has been pasted into Apps Script yet", which is **stale**. Whether the *tabs* exist is a separate question this pull cannot answer |
| **The editor is behind in one file** ⚠️ | *Habit Daily Grid* still defines `localDayOf()`, which the repo moved into Utilities. The live project therefore defines it **twice**. Harmless today — identical bodies — but it is a real collision, and pushing the repo fixes it |
| **The editor is ahead in one comment** | *Sync Sections* mentions `Fullsteam / Ascensus / Work`; the repo says `Ascensus / Work`. Comment-only — `TARGET_PROJECTS` is identical in both — so a push loses a stale note, not behaviour. Worth a glance before A4 in case Fullsteam was meant to be a real target |
| **Manifests captured** | Both are identical and minimal: `timeZone: America/Mexico_City`, `runtimeVersion: V8`, `exceptionLogging: STACKDRIVER`. This **confirms the timezone** the whole date layer depends on, and they are the manifests A4 brings into the repo |
| **Webhook projects not yet pulled** | Bound scripts do not appear in Drive and clasp v3 has no `list`, so their Script IDs must come from each spreadsheet's *Extensions → Apps Script → Project Settings* |

#### A4: the three open decisions

Answerable from a phone; none needs a terminal. A5 is blocked until they are settled, because
each one changes what gets pushed.

| # | Decision | Context |
| --- | --- | --- |
| 1 | **Is `Fullsteam` a real target project, or a stale comment?** | The live *Sync Sections* header says `Fullsteam / Ascensus / Work`; the repo says `Ascensus / Work`. `TARGET_PROJECTS = ["Ascensus", "Work"]` is identical in both, so today it is comment-only. If Fullsteam should be tracked, the **code** is wrong and needs a real change — not just the comment |
| 2 | **Confirm the deduplicated `localDayOf` is what ships.** | The repo defines it once (Utilities); the live project defines it twice. Pushing the repo removes the duplicate. Expected answer is yes — the alternative is keeping a known collision |
| 3 | **Does the manifest belong in `todoist/ts/appsscript/`?** | That is where it now sits, and A5 stages it into `dist/<project>/`. The alternative — `todoist/appsscript.json`, beside the `.gs` — is possible after the restructure but puts a deploy artefact in the source tree and forces a `.claspignore` to keep `.ts` files out of the push |

**Verified against clasp v3.4.1** (the earlier "check the flags" note is now settled):

| Finding | Consequence |
| --- | --- |
| `-P, --project <file>` selects a config | Multiple projects from one workspace works as planned: `.clasp-sync.json` and `.clasp-log.json` today, plus `.clasp-health.json` when the health webhook is rewritten |
| `srcDir` is the v3 name (`rootDir` still accepted), and clasp **refuses a `srcDir` that escapes the config's own directory** | A config in `todoist/ts/` cannot reach up to `todoist/`. The restructure did weaken the original argument — one integration per directory means a `.clasp.json` could now sit in `todoist/` and push in place — but the staged `dist/<project>/` in A5 still wins: clasp also pushes `.ts`, so an in-place push would upload `todoist/ts/src/**` unless a `.claspignore` fought it; the manifest would have to live in the source tree; and staging keeps clasp from ever writing into the working tree |
| `clasp status` lists exactly what would be pushed, changing nothing | A free dry-run. Run it before every `push:*`, and especially before the first |
| `clasp pull` writes into `srcDir` | Which is why A3 pulls into the scratchpad. A careless pull is as destructive as a push, in the other direction |

> ⚠️ **A3 is the one destructive gate in the whole plan.** `clasp push` overwrites the editor.
> The repo is ahead in four files, but only a diff proves the editor isn't *also* ahead
> somewhere else. Do not skip it, and do not reorder A5 before A4.

### Phase B — The seam

The interfaces that make everything above them platform-free. No behaviour moves yet.

| Step | What lands | Proof it's done |
| --- | --- | --- |
| **B1** | `src/ports/` — the six interfaces: `HttpTransport`, `TableStore`, `KeyValueStore`, `CacheStore`, `Clock`, `Logger` | `typecheck` passes; no implementation exists yet, by design |
| **B2** | `src/core/write-plan.ts` — `WriteOp`, `WritePlan`, `Match`; and `src/core/row.ts` | Unit tests for the three verbs against an in-memory table |
| **B3** | `src/adapters/gas/` — all six ports implemented over `SpreadsheetApp`, `UrlFetchApp`, `PropertiesService`, `CacheService`, `Session`, `Utilities`, `Logger` | Each adapter has a test using a fake of the GAS global |
| **B4** | esbuild build → `dist/{sync,log}/`, manifest copied in, IIFE + generated global footer. Push scripts split into `push:staging` (default) and `push:prod` (refuses without `--confirm`) | A hello-world entry point pushes and runs in the **A8 staging project**, writing to the test copy |
| **B4b** | **The production guard** in the GAS `TableStore`: a `PROTECTED_SPREADSHEET_IDS` list, and a config that throws when no target is set rather than defaulting to anything | A test asserts a write to a protected ID throws unless `allowProductionWrites` is explicitly true |
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
| **E0** 🔶 | **Refresh the test copy** from live, so the parallel run starts from identical data. Take a second, dated copy as the pre-cutover backup and leave it untouched |
| **E1** | Triggers installed on the staging project, matching the live schedule. Live keeps writing `quantified-self-todoist`; staging writes only the copy |
| **E2** | Both run for several days — **on two different spreadsheets, never the same one** |
| **E3** | A scratchpad diff harness compares the two spreadsheets tab by tab. Row-for-row equality is the bar for `Overdue`, `KarmaStats`, `RecurringStatus`, `HabitDaily`, `BillCycle` |
| **E4** 🔶 | Repoint the staging project's `TODOIST_SPREADSHEET_ID` at live and swap the triggers. Keep the `.gs` triggers installed-but-disabled for a week as rollback |
| **E5** | Freeze the legacy `.gs` files — a header line on each saying so |
| **E6** | `docs/todoist/architecture.md` rewritten once, to describe `todoist/ts/` |

**`TaskDaily` and `AreaDaily` cannot be replayed.** Their snapshot columns derive from their own
previous day, so a missed day is a permanent hole no re-run fills — both schema docs say so, and
`AreaDaily` carries `counts_observed` to mark it. Cut those two over on a day both
implementations ran, and verify the carried columns survive the seam before disabling anything.

### Phase F — GitHub Actions

Only after E. The scheduled syncs move; the webhooks never do.

| Step | What lands |
| --- | --- |
| **F1** 🔶 | Service account, Sheets API enabled. Share the **test copy as Editor and the live spreadsheet as Viewer** — the runner physically cannot corrupt production until F5 promotes it |
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
| **Async is banned in shared code** | Pipelines and services are synchronous; `async` exists only in `adapters/node/` | An Apps Script trigger cannot `await`: the entry point returns before the promise settles, so a **rejected** promise never reaches the executions dashboard and a failed nightly run reports success. The current code throws deliberately so failures surface there — that must survive the port |
| I/O shape | **Fetch → pure plan → Apply** | Makes the async ban free: the pipelines do no I/O, so they need no opinion about sync vs async, and the same code runs under both runtimes. This *is* the service/integration split — everything above `ports/` is pure, everything below is platform |
| Write model | A `WritePlan` value with three verbs — `append`, `replaceWhere`, `upsert` | Replaces eight hand-rolled write strategies with three, and maps 1:1 onto the tab-strategy table in [`todoist/README.md`](../../todoist/README.md) — the invariant the port must not break |
| Write target during the port | **`quantified-self-todoist-test`**, a copy, from step A8 until E4 | The port is unproven code with delete-and-replace verbs pointed at four years of data that partly cannot be re-fetched. A copy costs one menu click; a corrupted `TaskDaily` costs history that does not exist anywhere else |
| Config default | **Fail closed.** No spreadsheet ID is baked in; an unset target throws | A default that silently resolves to production is how a test run becomes an incident |
| Timezone | Explicit `timezone` config + `Intl.DateTimeFormat`; `Session.getScriptTimeZone()` deleted | A GitHub runner is UTC and has no ambient script timezone, so the ambient read must become a value. `history.md` records the 2026-08-20 seam this already caused once |
| State under Actions | A `_State` tab in the same spreadsheet | The cursor and In Review membership need somewhere durable. Actions cache expires in 7 days; repo commits are noisy; a tab needs no new credential |
| Cache under Actions | In-process `Map`, no TTL | A run is a fresh process, so a 6-hour TTL is meaningless. Costs one `/projects` + one `/sections` call per run |
| Tests | `node --test` over `todoist/ts/src/**/*.test.ts` | Zero new dependency on Node 24. Overrides the CLAUDE.md "no test framework unless asked" norm — asked for, because parity is the only proof the port is correct |
| Lockfile | **Now committed** | `npm ci` in Actions requires it, and there are real dependencies for the first time |
| Webhooks | Never leave Apps Script | Apple Shortcuts POST to a Web App URL, and a scheduled Actions job has no inbound endpoint. `event-log/` gets ported at D12; the health webhook is deleted pending a rework and should be *written* in these layers rather than ported |

### Layers and layout

```text
todoist/              # the integration — unchanged .gs + schema/, the parity reference
├── *.gs  schema/     # deployed today; frozen at the Phase E cutover
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

### Test spreadsheet and safety rails

The port is unproven code whose whole write model is *delete these rows, then write these* —
pointed at a spreadsheet holding history that in places cannot be re-fetched from anywhere. So
it develops against a copy, and four rails keep it there.

**The copy** (step A8): `quantified-self-todoist-test`, made with File → Make a copy so tabs,
headers, formats and real data shapes come along. Refresh it from live at E0 so the parallel run
starts from identical data.

| Rail | What it is | What it catches |
| --- | --- | --- |
| **Separate Apps Script project** | The staging project from A8 is standalone, with its own Script Properties | Script Properties are **per project, shared by every file in it**. Push the port into the live *Quantified Self - Todoist Sync* project and it inherits `TODOIST_SPREADSHEET_ID` = live, and the first run writes production. This is the likeliest way to get hurt, and a separate project is the only real defence |
| **Fail-closed config** | No spreadsheet ID has a default; an unset target throws | A missing property producing a silent write to the wrong place |
| **Protected-ID guard** (B4b) | The GAS `TableStore` refuses to write to any ID in `PROTECTED_SPREADSHEET_IDS` unless `allowProductionWrites` is explicitly set | A fat-fingered property, a copy-pasted ID, a stale config surviving a refactor |
| **Dry-run** (B4c) | The applier logs the `WritePlan` instead of applying it | Everything, before it happens. Nearly free: because a plan is a *value*, printing it instead of applying it is one branch in one function — the strongest argument for the Fetch → plan → Apply shape |

**What corruption would actually look like**, so the cautions aren't abstract:

- **`TaskDaily` and `AreaDaily` are unrecoverable.** Their snapshot columns derive from their own
  previous day and Todoist keeps no history of what was open on a past date. A stray
  `replaceWhere {equals: today}` deletes rows that cannot be re-fetched, re-derived, or
  reconstructed. This is the highest-severity outcome in the whole plan.
- **`Completions` is append-only with a persisted cursor.** A test run that advances
  `TODOIST_LAST_SYNC` against production makes the *live* sync skip that window on its next run —
  corruption at a distance, in a tab that looked untouched. Cursor state must live with the
  spreadsheet it describes.
- **`HabitDaily` rebuilds a trailing window**, so a bad run wipes the window and rewrites it
  wrong. Recoverable — `backfillHabitDaily()` exists — but only if `Completions` and
  `RecurringStatus` are still intact underneath.
- **A layout guard can archive a tab.** `archiveAndRecreateSheet()` fires on an incompatible
  header, so a port with a wrong header constant doesn't error — it renames your tab and starts
  a fresh empty one. Every Looker Studio data source bound to that tab breaks at once.

**Two rules that need no tooling.** Never run a port entry point from the live project's editor
during Phases B–D — the editor's Run button uses that project's properties. And take a dated
copy before E4 and before F5, the two moments the target changes.

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

Today ~30 callable functions are scattered across the 10 `todoist/*.gs` files with no index. Instead, one array is
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

### Open questions

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
