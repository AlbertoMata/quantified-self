# quantified-self

Personal daily event and habit tracker with minimal interaction — built
around Apple Watch, AirPods, Apple Shortcuts and Todoist, with a centralized
view in Obsidian and Looker Studio. Solo project, no server — sync scripts
and design docs, currently being ported from Apps Script to TypeScript.

## Layout

- **One top-level directory per integration**, each holding its own code,
  schema docs and setup: `todoist/` (the big one — its 10 `.gs` files live in
  `todoist/legacy-implementation/`),
  `health/` (schema only for now — its webhook was deleted pending a
  rework), `event-log/` (which also holds every Apple Shortcut). Read the directory's `README.md` and `schema*.md`
  before changing any sync script's output shape — the schema docs are the
  contract, not a description.
- `trackingtime/` — replaces the retired Everhour integration. **Not built**,
  docs only. Everhour's code and schema were deleted; the live Apps Script
  trigger still needs disabling (noted in that README).
- `todoist/ts/` — the TypeScript port in progress, an npm workspace. Platform-agnostic core behind
  port interfaces; see `docs/plans/typescript-port.md` for the step list and
  the rule that Google globals may only appear in `src/adapters/gas/`.
- `docs/sheets.md` — index of which spreadsheet exists and who writes it.
- `event-log/shortcuts/` — `generate-log-event.py` produces Apple Shortcuts log-event
  output; `event-log/shortcuts/generated/` is gitignored, don't commit into it.
- `docs/plans/` — design docs for larger changes. `habits-dashboard.md` is
  the pattern to follow: a Decisions table, then a part-by-part breakdown of
  what's implemented vs. still to do.
- `obsidian/`, `todoist/looker/` — docs/templates for the Obsidian and Looker
  side of the pipeline.
- `app/` — currently empty.

## Tooling

- `npm run format` — prettier (tabs, width 8) over `**/*.gs`,
  `todoist/ts/src/**/*.ts` and `todoist/ts/scripts/**/*.mjs`. Run after touching
  any of them. Note two `.gs` files are committed unformatted, so `format:gs`
  will reformat them incidentally; don't include that churn in an unrelated
  commit. The TS glob is deliberately **not** run with
  `--no-error-on-unmatched-pattern`: it used to say `ts/**/*.ts`, a path that
  stopped existing at the one-directory-per-integration restructure, and the
  flag meant prettier matched zero files and exited 0 for months. Let a wrong
  path fail loudly.
- `npm --workspace todoist/ts run build` bundles the port to one Apps Script
  file via esbuild, and **runs it in a sandbox before writing it**. Entry
  points come from `src/entrypoints/registry.ts` — adding one there is what
  makes it callable in the editor; nothing else exposes a global, and every
  generated global is `port`-prefixed until the E4 cutover.
- `npm test` and `npm run typecheck` are **real** and must stay green. Tests
  are `node --test` over `todoist/ts/src/**/*.test.ts` — Node 24 runs `.ts` directly,
  so there is no build step for tests and no test framework dependency.
- `package-lock.json` **is** committed — `npm ci` needs it once the port
  reaches GitHub Actions.
- `todoist/ts/` is an npm workspace: run everything from the repo root
  (`npm --workspace todoist/ts run <script>`), never `cd ts`.
- **`clasp` deploys the `.gs` files — pasting into the editor is no longer the
  deploy path.** Two live projects, each pushed from its own staged directory:
  `npm --workspace todoist/ts run push:sync` (the ten
  `todoist/legacy-implementation/*.gs`) and `push:log` (the event-log webhook).
  `status:sync` / `status:log` are free dry-runs; run one first.
  Three things that have each bitten already:
  **a push replaces the whole project**, deleting editor files absent from the
  staged directory; **`clasp push` exits 0 when it skips**, so success is proved
  by re-reading the remote, never by the exit code; and a push that changes
  `appsscript.json` prompts, then silently skips *everything* with no TTY to
  answer. Auth lives in `~/.clasprc.json` and does not travel between machines.

## Workflow norms

- Free to edit, commit, and push feature branches, and to open PRs,
  without asking first.
- Always confirm before: pushing directly to `main`, merging a PR,
  force-pushing, or deleting a branch.
