# sheets/ts — the TypeScript port

The Apps Script sync jobs, being rewritten in layers so the same logic can run either on
Apps Script or on a GitHub Actions runner. The design, the step list and the safety rails
live in [`../../docs/plans/typescript-port.md`](../../docs/plans/typescript-port.md).

**Status: Phase A.** The `.gs` files in [`../`](../) are still the deployed implementation.
Nothing here runs against a real spreadsheet yet.

> 🔒 Nothing in this workspace may point at `quantified-self-todoist`. Development targets a
> copy — see the plan's [safety rails](../../docs/plans/typescript-port.md#test-spreadsheet-and-safety-rails).

## Commands

All run from the **repo root**, not from this directory:

```sh
npm install                        # one install, workspace-hoisted
npm run typecheck                  # tsc --noEmit
npm test                           # node --test, runs .ts directly
npm run format                     # prettier over **/*.gs and sheets/ts/**/*.ts
```

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
  everhour.json   manifest pulled from the live Everhour Sync project (A3)
src/
  config.ts       fail-closed settings reader — nothing defaults to a live spreadsheet
```

Both manifests are `timeZone: America/Mexico_City`, `runtimeVersion: V8`,
`exceptionLogging: STACKDRIVER`. That timezone is the one the whole date layer depends on —
see the plan's timezone decision.

## Apps Script projects

Four, not the one the older docs describe — confirmed by pulling them in A3:

| Project | Binding | Files | Config (gitignored) |
| --- | --- | --- | --- |
| Quantified Self - Todoist Sync | standalone | 10 | `.clasp-sync.json` |
| Quantified Self - Everhour Sync | standalone | 1 (`Código.js`) | `.clasp-everhour.json` |
| Log webhook | bound to `quantified-self-log` | 1 | `.clasp-log.json` |
| Health webhook | bound to `quantified-self-health` | 1 | `.clasp-health.json` |
