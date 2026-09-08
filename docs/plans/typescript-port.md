# Apps Script → TypeScript port — design

**Status** (2026-09-08): **nothing implemented.** Every `.gs` file under
[`../../sheets/`](../../sheets/) stays the deployed source of truth and is not edited by any
part of this plan. The port lives in a new `sheets/ts/` workspace and only takes over at the
Part 5 cutover; the GitHub Actions runtime in Part 6 comes after that. Parts 1 and 7 are the
ones worth doing first — they pay off before a single line is ported.

The goal is three changes that happen to share one plan: stop deploying by copy-paste, split
the code into layers that can be read one at a time, and push every Apps Script global behind
an interface so the same logic can run on a GitHub runner. The third is the reason for the
first two — a flat script that calls `SpreadsheetApp` from the middle of a loop cannot be
lifted anywhere.

[`../todoist/architecture.md`](../todoist/architecture.md) §6 already lists the couplings that
need replacing, and §7 the behaviours a reimplementation breaks quietly. This plan builds on
both rather than restating them; read §6 first.

## Why now

**Deployment is manual and unverified.** [`../../sheets/README.md`](../../sheets/README.md)
tells you to paste seven files into the Apps Script editor. Nothing checks that what runs
tonight is what is committed. There is no diff, no history, no way to answer "is the editor
ahead of the repo?" — which is also the one real risk in Part 1.

**One namespace, 111 globals.** The `quantified-self-sync` project concatenates
`everhour-sync.gs` and the six `todoist/*.gs` files into a single flat scope
(architecture.md §1). The file split is organisational only, and it has already collided:
`toDateString()` is defined **twice** — at
[`../../sheets/everhour-sync.gs:390`](../../sheets/everhour-sync.gs#L390) and
[`../../sheets/todoist/todoist-sync-utils.gs:253`](../../sheets/todoist/todoist-sync-utils.gs#L253).
The bodies are identical today, so whichever loads last wins and nothing is harmed. Nothing
would report it if they diverged, either — and `everhour-sync.gs` already had to inline its own
query builder "to avoid name collisions with todoist-sync.gs in the shared project namespace".
That comment is the design asking for modules.

**The logic is worth more than the platform.** The parts that took real work to get right —
`habitDayStatus`, `nextStreak`, the composite completion key, the UTC-vs-local date split — are pure functions with no reason to be locked
inside Apps Script. They are also, today, untested outside throwaway scratchpad harnesses.

## Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Existing `.gs` | **Kept, untouched, deployed** | The port is a parallel tree, not a refactor. `sheets/**/*.gs` stays the running implementation *and* the thing the port is diffed against, right through Part 5. Nothing is deleted until something proven replaces it |
| Port location | `sheets/ts/`, a self-contained **npm workspace** | Code sits beside the schema docs it must satisfy. Every Node/TS/clasp config lives *inside* the workspace, so the repo root keeps only prettier and stays free for a future `app/` Swift project. Rejected `src/` at the root for exactly that reason |
| Language | TypeScript, **erasable syntax only** | Node 24 runs `.ts` directly (type stripping is on by default), so tests need no build and no new dependency. The price is no `enum`, no `namespace`, no parameter properties — use `const` objects and `import type` |
| Build | esbuild → one IIFE bundle per Apps Script project | Apps Script has no module loader. esbuild is the only build step, one dependency, and sub-second |
| **Async is banned in shared code** | Pipelines and services are synchronous. `async` exists only in `adapters/node/` | An Apps Script trigger cannot `await`: the entry point returns before the promise settles, so a **rejected** promise never reaches the executions dashboard and a failed nightly run reports success. The current code throws deliberately so failures surface there — that must survive the port |
| I/O shape | **Fetch → pure plan → Apply** | Makes the async ban free. The pipelines never do I/O, so they need no opinion about sync vs async, and ~90% of the code is identical under both runtimes. This *is* the service-layer/integration-layer split: everything above `ports/` is pure, everything below is platform |
| Write model | A `WritePlan` value with three verbs — `append`, `replaceWhere`, `upsert` | Replaces five hand-rolled write strategies with three, and maps 1:1 onto the idempotency table in architecture.md §3 — the invariant the port must not break |
| Timezone | Explicit `timezone` config + `Intl.DateTimeFormat`; `Session.getScriptTimeZone()` deleted | §6 calls this the coupling that is "not cosmetic". A GitHub runner is UTC and has no ambient script timezone, so the ambient read must become a value. [`../../sheets/todoist/history.md`](../../sheets/todoist/history.md) records the 2026-08-20 UTC→local seam this already caused once |
| State under Actions | A `_State` tab in the same spreadsheet | `TODOIST_LAST_SYNC` and `TODOIST_IN_REVIEW_PREV` need somewhere durable. Actions cache expires in 7 days; committing to the repo is noisy; a tab is the store the data already lives in and needs no new credential |
| Cache under Actions | An in-process `Map`, no TTL | A run is a fresh process, so a 6-hour TTL is meaningless. Costs one `/projects` and one `/sections` call per run. Keep the 100KB `CacheService` cap in mind on the GAS side — §7 says it is why the live task map is never cached |
| Tests | `node --test` over `sheets/ts/src/**/*.test.ts` | Zero new dependency on Node 24. Overrides the CLAUDE.md "no test framework unless asked" norm — asked for, because parity with the `.gs` originals is the only proof the port is correct. Root `npm test`'s `exit 1` stub becomes real |
| Lockfile | **Now committed** | `npm ci` in Actions requires it, and there are real dependencies for the first time. Reverses the current `.gitignore` line and the CLAUDE.md note |
| Secrets | Unchanged in principle | Script Properties for Apps Script; GitHub Secrets + a service account for Actions. `.clasp-*.json` is gitignored because it carries `scriptId`s, with a committed `.clasp.example.json` |
| Webhooks | Ported, but never leave Apps Script | Apple Shortcuts POST to a Web App URL. A scheduled Actions job has no inbound endpoint, and giving it one means Cloud Run plus re-pointing every shortcut — out of scope |

## Target layout

```
sheets/
├── *.gs, todoist/*.gs           # unchanged. Deployed, and the parity reference
├── schema-*.md, todoist/schema/ # unchanged. The contract BOTH implementations satisfy
└── ts/                          # the port — one self-contained npm workspace
    ├── package.json             # esbuild, clasp, typescript, @types/google-apps-script
    ├── tsconfig.json
    ├── .clasp.example.json      # committed; .clasp-*.json gitignored (scriptIds)
    ├── appsscript/              # one manifest per Apps Script project
    │   ├── sync.json  log.json  health.json
    ├── src/
    │   ├── core/                # pure — dates, keys, statuses, streaks, board seeding
    │   ├── services/            # pure — endpoint descriptors, parsers, row mappers
    │   ├── pipelines/           # pure — snapshot → WritePlan, one per tab
    │   ├── ports/               # interfaces only, no implementations
    │   ├── adapters/
    │   │   ├── gas/             # SpreadsheetApp, UrlFetchApp, PropertiesService, CacheService
    │   │   └── node/            # googleapis, fetch, env, Map
    │   ├── entrypoints/
    │   │   ├── gas/             # syncTodoist(), syncTodoistIntraday(), doPost() …
    │   │   └── node/            # the CLI GitHub Actions runs
    │   └── **/*.test.ts         # beside the unit under test
    ├── dist/                    # gitignored. clasp pushes from here
    └── README.md                # the workspace's own map + commands
```

The layer contract, which is the whole point:

| Layer | Contains | Knows about the platform? |
| --- | --- | --- |
| `core/` | `localDay`, `dateKey`, `habitDayStatus`, `nextStreak`, `dueTimeOf`, `extractComplexity` | **No.** Pure, and the most heavily tested |
| `services/` | Per-source knowledge: Todoist and Everhour endpoint descriptors, response parsers, row mappers, the pagination step rule | **No.** Describes requests, never issues them |
| `pipelines/` | One per tab: `plan(snapshot, config, today) → WritePlan` | **No.** The nightly logic, with zero I/O |
| `ports/` | `HttpTransport`, `TableStore`, `KeyValueStore`, `CacheStore`, `Clock`, `Logger` | The seam itself |
| `adapters/gas/`, `adapters/node/` | The integration layer, and the *only* place a platform global may appear | **Yes**, and nowhere else |
| `entrypoints/` | Trigger functions and the CLI — the eight lines where the three phases meet | Yes |

One rule enforces it: **`SpreadsheetApp`, `UrlFetchApp`, `PropertiesService`, `CacheService`,
`Session`, `Utilities` and `Logger` may only be named inside `src/adapters/gas/`.** A grep for
those seven identifiers outside that directory is the cheapest possible architecture test, and
Part 4 makes it one.

## The npm and clasp workflow

Everything runs from the repo root — no `cd`, one `node_modules`, one install:

```
npm install                        # workspace-hoisted from the root
npm -w sheets/ts run typecheck     # tsc --noEmit
npm test                           # → npm -w sheets/ts test  (node --test)
npm -w sheets/ts run build         # esbuild → sheets/ts/dist/<project>/ + the manifest
npm -w sheets/ts run push:sync     # clasp push   (also push:log, push:health)
npm -w sheets/ts run sync:todoist  # the Node entry point, for local runs and Actions
npm run format                     # prettier, glob extended to **/*.{gs,ts}
```

The root `package.json` gains exactly two things: `"workspaces": ["sheets/ts"]` and a `test`
script delegating to the workspace. Prettier stays at the root and keeps its tabs/width-8
config, which suits TypeScript unchanged.

**Bundling for Apps Script.** esbuild emits `--bundle --format=iife --global-name=QS
--target=es2019`, and a footer re-exports each trigger as a top-level function
(`function syncTodoist(){ return QS.syncTodoist(); }`) because Apps Script can only invoke
globals. The build also copies the right `appsscript/*.json` into the bundle directory —
clasp requires the manifest to sit in `rootDir`.

**Three Apps Script projects, three configs:**

| Project | Binding | Config | `rootDir` | Entry points |
| --- | --- | --- | --- | --- |
| `quantified-self-sync` | Standalone | `.clasp-sync.json` | `dist/sync` | `syncTodoist`, `syncTodoistIntraday`, `syncEverhour`, the reschedule and diagnostic functions |
| `quantified-self-log` | Bound to the Log sheet | `.clasp-log.json` | `dist/log` | `doPost`, `doGet` |
| `quantified-self-health` | Bound to the Health sheet | `.clasp-health.json` | `dist/health` | `doPost`, `doGet` |

Verify flags against `clasp --help` when implementing: v3 renamed several v2 flags, and the
multi-project invocation is the part most likely to have moved.

## Part 1 — clasp adopts the current scripts, no code change

Worth doing on its own, before any TypeScript exists: it ends copy-paste deployment for code
that already works.

1. Add `@google/clasp` to the workspace, `clasp login`.
2. **`clasp clone` each of the three projects into the scratchpad and diff against the repo.**
   Do this before anything else.
3. Reconcile any drift **into the repo**, and commit it.
4. Only then push. From here, `sheets/README.md`'s "paste into the editor" steps become
   `npm -w sheets/ts run push:*`.

> ⚠️ `clasp push` **overwrites the editor.** If the live project holds a hand-edit that was
> never committed back, pushing destroys it silently. Step 2 is not optional, and it is the
> single destructive risk in this plan.

For this part the `rootDir`s point at `sheets/` and `sheets/todoist/` as they are — the `.gs`
files are already valid JavaScript. Nested paths become `todoist/todoist-sync` in the editor,
which is cosmetic.

## Part 2 — The layering

Three types carry the whole design.

```ts
// ports/http.ts — synchronous by contract. GAS satisfies it natively;
// the Node adapter satisfies it by resolving before it returns.
export interface HttpTransport {
	get(url: string, headers: Record<string, string>): HttpResponse;
	post(url: string, headers: Record<string, string>, body: string): HttpResponse;
}

// ports/tables.ts
export interface TableStore {
	read(spec: LoadSpec): Row[];   // tab + columns, so we never read more than needed
	apply(plan: WritePlan): void;
}
```

```ts
// core/write-plan.ts — the three verbs
export type WriteOp =
	| { mode: "append"; tab: string; rows: Row[] }
	| { mode: "replaceWhere"; tab: string; column: number; match: Match; rows: Row[] }
	| { mode: "upsert"; tab: string; keyColumn: number; rows: Row[] };

export type Match = { eq: string } | { gte: string };

export interface WritePlan {
	writes: WriteOp[];
	state: Record<string, string>; // KV to persist AFTER the writes land — see §7
	logs: string[];
}
```

`match` takes a predicate rather than a bare equality because `HabitDaily` replaces a trailing
*window* (`date >= cutoff`), not one day. Everything else uses `eq`.

Mapping the existing strategies onto the verbs — this table is the parity contract, and it
restates architecture.md §3 in the port's vocabulary:

| Tab | Verb | Key |
| --- | --- | --- |
| `Completions` | `append` | `task_id \| completed_at`, plus the persisted cursor |
| `Overdue` | `replaceWhere` `{eq: today}` | `snapshot_date` |
| `KarmaStats` | `upsert` | `date` |
| `RecurringStatus` | `append` | `snapshot_date \| task_id` |
| `HabitDaily` | `replaceWhere` `{gte: cutoff}` | `date \| task_id` |

**Every entry point then reads the same eight lines**, and they are the only place the three
phases meet:

```ts
// entrypoints/gas/todoist.ts
function syncOverdue() {
	const rt = gasRuntime();                                    // adapters/gas
	const today = localDay(rt.clock.now(), config.timezone);    // core
	const tasks = fetchAll(rt.http, todoistRequests.overdue()); // integration
	const plan = planOverdue({ tasks, projects: projectMap(rt) }, config, today); // pure
	rt.tables.apply(plan);                                      // integration
	plan.logs.forEach(rt.log);
}
```

The Node entry point is the same six statements with `await` on the two integration lines.
That duplication is deliberate and bounded: it is the *only* code written twice.

**Pagination** stays pure by being a step rule rather than a loop —
`nextPage(state, lastResponse) → {done} | {request}`. The two empirically-earned rules in
architecture.md §7 (break on an empty batch even when `has_more` is true; `limit=50` is a hard
cap, not a preference) become two unit tests instead of two comments.

## Part 3 — Port order

Each step lands with its tests and its doc updates. Nothing moves to the next step until
`npm test` is green.

| # | Moves | Why here | Docs touched |
| --- | --- | --- | --- |
| 1 | `core/` — dates, keys, `num`, `splitLabels`, `durationMinutes`, `extractComplexity` | Everything depends on it, and it is where the duplicate `toDateString` dies: one `utcDay()` and one `localDay(date, tz)`, never an ambient timezone | `sheets/ts/README.md` |
| 2 | `services/todoist/` — request descriptors, parsers, the pagination step | The one shared dependency of every pipeline below | — |
| 3 | Overdue, RecurringStatus, KarmaStats | One API call → one write op each. Proves the sandwich on the simplest possible shape | `schema/overdue.md`, `recurring-status.md`, `karma-stats.md` (parity check only) |
| 4 | Completions | Three sources, a persisted cursor, composite-key dedup, and the In Review snapshot diff. The hardest fetch pipeline — do it once the shape is proven | `schema/completions.md` |
| 5 | HabitDaily | Already pure: it reads tabs, not the API. It becomes the showcase for the middle layer, and it carries the most logic worth testing | `schema/habit-daily.md` |
| 6 | Everhour | Independent of all of the above; its rate limiter becomes a `services/` policy driven by the adapter's sleep | `schema-everhour.md` |
| 7 | Reschedule habits | The only write path to Todoist, and manual. Port last, deliberately, and keep it manual | architecture.md reschedule table |
| 8 | The two webhooks | Tiny (`doPost`/`doGet`), but separate clasp projects with their own deploys | `sheets/README.md` |

## Part 4 — Verification

`node --test`, no framework, tests beside the unit under test:

- **The pure core carries the load.** The scratchpad harness already written for the habit
  features becomes a committed test instead of evaporating.
- **The §7 edge cases become tests**, one per row: empty page with `has_more=true`, the
  `limit=50` clamp, non-JSON responses, the streak rule's carry-on-`pending`, and the
  UTC-vs-local evening case.
- **The layering test**: assert no file outside `src/adapters/gas/` names any of the seven
  Apps Script globals. Three lines, and it is what keeps the port agnostic a year from now.
- **The doc tripwire** from Part 7.

## Part 5 — Cutover

The `.gs` scripts run until the port has proven itself against live data:

1. Build and push to a **staging** Apps Script project bound to a **copy** of the spreadsheet.
2. Run both implementations for several days on the same schedule.
3. Diff the tabs (a scratchpad script, not committed). Row-for-row equality is the bar for
   `Overdue`, `KarmaStats`, `RecurringStatus` and `HabitDaily`.
4. Swap the triggers on the real project; keep the `.gs` project's triggers disabled but
   installed for one week as the rollback.
5. Freeze `sheets/**/*.gs` as reference and say so at the top of each file.

**A self-referential snapshot tab cannot be replayed.** None exists today — every current tab
either re-fetches from the API or rebuilds from another tab — but `TaskDaily` in
[`life-areas.md`](life-areas.md) will be one: its age columns derive from its own previous
snapshot, so a missed day becomes a permanent hole no re-run can fill. Cut a tab like that over
on a day both implementations ran, and verify the carried columns survive the seam before
disabling the old trigger.

## Part 6 — GitHub Actions runtime

Only after Part 5. The scheduled syncs move; the webhooks stay.

- **Auth**: a Google Cloud service account with the Sheets API enabled. Share each spreadsheet
  with the service account's email as Editor — no OAuth refresh, no domain-wide delegation.
- **Secrets**: `TODOIST_TOKEN`, `EVERHOUR_API_KEY`, `TODOIST_SPREADSHEET_ID`,
  `EVERHOUR_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`.
- **Schedule**: GitHub cron is UTC-only. Mexico City has had no DST since 2022, so 23:30 local
  is `30 5 * * *` UTC year-round and the intraday window is `0 13-23,0-4 * * *`. The in-code
  07:00–23:00 guard **stays**, so the cron expression is never load-bearing — verify the offset
  against the tz database rather than trusting this line.
- **Reliability, and it is worse than Apps Script triggers**: scheduled workflows are
  best-effort and get delayed under load, they run only on the default branch, and GitHub
  **disables them after 60 days of repository inactivity** — a real risk for a personal repo.
  The nightly run "finalises the day", so a delay past midnight files rows on the wrong date
  unless the run computes its own target day rather than trusting the clock. Add a
  `concurrency` group so a delayed run and the next scheduled one cannot overlap.
- **What relaxes**: the 6-minute execution cap is gone, so the windowing and batching that
  exist only to dodge it (architecture.md §1) *may* be simplified — knowingly, one at a time,
  never as a side effect of the port.
- **The manual reschedule** becomes a `workflow_dispatch` job, or stays editor-run — see the
  open questions.

## Part 7 — Keeping the documentation true

The real risk of a parallel port is not bad code, it is two implementations and one set of docs
that quietly describes neither. Five rules:

1. **One owner per document.** [`../todoist/architecture.md`](../todoist/architecture.md)
   describes *the deployed implementation* — the `.gs` files until Part 5, `sheets/ts/` after,
   rewritten once at cutover. There is never a second architecture doc. Until then it gains one
   line pointing here, and nothing else.
2. **The schema docs are the port's specification.**
   [`../../sheets/todoist/schema/`](../../sheets/todoist/schema/) describes tab columns and
   behaviour, not code, so it already serves both implementations unchanged. Their "Behaviour
   and edge cases" tables are the parity checklist for each Part 3 step — the port is done when
   the tests read like those tables.
3. **Doc updates ride inside the port step**, never after it. The Part 3 table names the docs
   each step touches for exactly this reason, the way
   [`habits-dashboard.md`](habits-dashboard.md) carries a "Docs to update alongside" subsection.
4. **A mechanical tripwire.** A `node --test` case parses the column tables out of
   `schema/*.md` and asserts they match the `HABIT_DAILY_HEADER` and `COLS` constants in the
   TypeScript. This catches the single most common drift — adding a
   column and forgetting the doc — and needs no new dependency. It is also the only doc rule
   here that does not rely on anyone remembering it.
5. **`CLAUDE.md` is updated in Part 1**, not at the end, because it steers every future
   session: where the port lives, that `sheets/**/*.gs` is frozen reference, that a build step
   now exists, that `npm test` is real, and that the lockfile is committed.

## Docs to update, per part

| Doc | Part | Change |
| --- | --- | --- |
| `CLAUDE.md` | 1 | Workspace layout, build step, real `npm test`, committed lockfile, `.gs` frozen |
| `README.md` | 1 | Tree gains `sheets/ts/`; this plan is already listed |
| `sheets/README.md` | 1, 8 | Setup steps: paste → `clasp push`. Webhook deploys unchanged otherwise |
| `sheets/ts/README.md` | 1 | New. The workspace map, the layer rule, the commands |
| `sheets/todoist/schema/*.md` | 3–6 | Parity check per step; edits only where the port reveals the doc was wrong |
| `docs/todoist/architecture.md` | 5 | Rewritten once at cutover to describe `sheets/ts/`; §6 becomes a record of what was done |

## Open questions

- **One Apps Script project or two?** Todoist and Everhour share `quantified-self-sync` today,
  which is what forced the `toDateString` collision and the inlined query builder. Modules
  remove the reason to split — but two projects also mean two independent failure surfaces and
  two trigger sets. Splitting is cheap during Part 6 and expensive later.
- **Does the reschedule move to Actions?** It is the only write path to Todoist and is
  deliberately manual. `workflow_dispatch` gives it an audit log and takes it off the editor;
  leaving it in Apps Script keeps the one destructive path behind a button only you can press.
- **Does `_State` belong in the data spreadsheet or its own?** A `_State` tab is simplest, but
  it puts cursor state one accidental sort away from the data it guards.
