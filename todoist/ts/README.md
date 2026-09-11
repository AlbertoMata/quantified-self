# ts — the TypeScript port

The Apps Script sync jobs, being rewritten in layers so the same logic can run either on
Apps Script or on a GitHub Actions runner. The design, the step list and the safety rails
live in [`../docs/plans/typescript-port.md`](../../docs/plans/typescript-port.md).

**Status: Phase A.** The `.gs` files in [`../todoist/`](../), [`../health/`](../../health/)
and [`../event-log/`](../../event-log/) are still the deployed implementation.
Nothing here runs against a real spreadsheet yet.

> 🔒 The port runs **in the production project against the production spreadsheet** (decided
> 2026-09-10). Isolation comes from names, not separate infrastructure: every generated global
> is `port`-prefixed, every tab it writes ends `_port`, and every state key starts `PORT_`.
> See the plan's [safety rails](../../docs/plans/typescript-port.md#safety-rails-without-a-second-project)
> — and note that git covers the code, not the spreadsheet.

## Commands

All run from the **repo root**, not from this directory:

```sh
npm install                        # one install, workspace-hoisted
npm run typecheck                  # tsc --noEmit
npm test                           # node --test, runs .ts directly
npm run format                     # prettier over **/*.gs and ts/**/*.ts
```

## Deploying the legacy `.gs` (A5)

Deployment is `clasp push`, not copy-paste. clasp never reads the working tree: a staging
step copies the `.gs` files plus the right manifest into `dist/<project>/`, and clasp pushes
only from there.

```sh
npm --workspace todoist/ts run stage:sync    # legacy-implementation/*.gs + manifest -> dist/sync/
npm --workspace todoist/ts run status:sync   # stage, then list what WOULD be pushed
npm --workspace todoist/ts run push:sync     # stage, then overwrite the live editor
```

`status:*` is a free dry-run that changes nothing. **Run it before every push**, because
`clasp push` replaces the project's entire contents with whatever is in `dist/`.

| Why staged | Reason |
| --- | --- |
| clasp pushes *every* file in `srcDir` | Pointing it at the working tree would upload `src/**/*.ts` too, unless a `.claspignore` fought it |
| The manifest must match the remote **byte for byte** | Otherwise `clasp push` prompts, and with no TTY it prints `Skipping push.` and **exits 0** having deployed nothing. Never trust the exit code — re-read the remote |
| `srcDir` cannot escape its config's directory | A config here cannot reach up to `../*.gs` |
| The manifest would otherwise live in the source tree | It is a deploy artefact, not source |
| `dist/` is gitignored and rebuilt from scratch every time | A file deleted from the repo also leaves the push — which a hand-maintained directory would not guarantee |

Legacy stages **unbundled**, one `dist` file per `.gs`, so the editor stays diffable
file-by-file against the repo. Bundling into a single paste-ready file starts at B4, and
applies only to ported code.

`.clasp-<project>.json` carries a real `scriptId`, so it is gitignored. Copy
`.clasp.example.json` and fill it in; the plan records how to re-find the IDs.

## Why the tooling looks like this

| Choice | Reason |
| --- | --- |
| Node ≥ 22.18 | Runs `.ts` files directly by stripping types, so tests need no build step and no test framework |
| `erasableSyntaxOnly` | Type stripping can only *erase*, never generate code. No `enum`, no `namespace`, no parameter properties — the flag turns those into compile errors instead of runtime surprises |
| `target`/`lib` = ES2019 | What the Apps Script V8 runtime guarantees. Constraining the type system to it stops us using a built-in that typechecks locally and throws at 23:30 |
| `.ts` import extensions | Node resolves them natively; `allowImportingTsExtensions` lets `tsc` agree. esbuild produces the Apps Script bundle |
| `"type": "module"` | ESM here regardless of the root package's `commonjs`, which is what Node's type stripping expects |

## Layout

Filled in as the phases land; the plan describes the target shape in full.

```text
appsscript/
  todoist.json    manifest pulled from the live Todoist Sync project (A3)
scripts/
  prepare-legacy.mjs   stages a project's .gs + manifest into dist/<project>/
src/
  config.ts       fail-closed settings reader — nothing defaults to a live spreadsheet
dist/             gitignored, regenerable. The only directory clasp ever reads
```

The manifest is `timeZone: America/Mexico_City`, `runtimeVersion: V8`,
`exceptionLogging: STACKDRIVER`. That timezone is the one the whole date layer depends on —
see the plan's timezone decision.

## Apps Script projects

Three, not the one the older docs describe — confirmed by pulling them in A3. (A fourth,
*Quantified Self - Everhour Sync*, is [retired](../../trackingtime/README.md) and still needs its live
trigger disabled.)

| Project | Binding | Files | Config (gitignored) |
| --- | --- | --- | --- |
| Quantified Self - Todoist Sync | standalone | 10 | `.clasp-sync.json` — **captured; pushed and verified** |
| Log webhook | bound to `quantified-self-log` | 1 | `.clasp-log.json` — needs its Script ID *and* its real manifest |
| Health webhook | bound to `quantified-self-health` | **0 — code deleted** pending a [rework](../../health/README.md) | `.clasp-health.json`, once there is code |
