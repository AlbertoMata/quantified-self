# quantified-self

Personal daily event and habit tracker with minimal interaction — built
around Apple Watch, AirPods, Apple Shortcuts, Todoist, and Everhour, with a
centralized view in Obsidian and Looker Studio. Solo project, no build step,
no server — mostly sync scripts and design docs.

## Layout

- `sheets/` — Google Apps Script (`.gs`) that syncs Todoist/Everhour data
  into Google Sheets. Each integration subdirectory (`sheets/todoist/`,
  `sheets/event-log/`, etc.) has its own `README.md`/schema doc alongside
  the scripts — read that before changing a sync script's output shape.
- `shortcuts/` — `generate-log-event.py` produces Apple Shortcuts log-event
  output; `shortcuts/generated/` is gitignored, don't commit into it.
- `docs/plans/` — design docs for larger changes. `habits-dashboard.md` is
  the pattern to follow: a Decisions table, then a part-by-part breakdown of
  what's implemented vs. still to do.
- `obsidian/`, `analytics/` — docs/templates for the Obsidian and Looker
  side of the pipeline.
- `app/` — currently empty.

## Tooling

- `npm run format` — prettier (tabs, width 8) over `**/*.gs`. Run this
  after touching any Apps Script file.
- `npm test` is a stub that always fails (`exit 1`) — there is no real test
  suite yet. A red `npm test` is not a signal; don't add a test framework
  unless asked.
- No lockfile is committed (`package-lock.json` is gitignored).

## Workflow norms

- Free to edit, commit, and push feature branches, and to open PRs,
  without asking first.
- Always confirm before: pushing directly to `main`, merging a PR,
  force-pushing, or deleting a branch.
