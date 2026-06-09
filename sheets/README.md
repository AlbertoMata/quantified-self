# Sheets

Four Google Sheets, one per data source. Each is an independent spreadsheet — separate permissions, separate Apps Script deployments, but all blendable in Looker Studio on a shared `date` key.

---

## Spreadsheets

| Sheet name | Tabs | Populated by | Schema |
| --- | --- | --- | --- |
| `quantified-self-log` | `Log` | Apps Script webhook (push from Shortcuts) | [schema.md](schema.md) |
| `quantified-self-health` | `Health` | `health-webhook.gs` ← "Health Sync" shortcut (daily 23:55) | [schema-health.md](schema-health.md) |
| `quantified-self-todoist` | `Completions`, `Overdue`, `KarmaStats` | `todoist-sync.gs` (nightly 23:30) | [schema-todoist.md](schema-todoist.md) |
| `quantified-self-everhour` | `TimeEntries`, `DailySummary` | `everhour-sync.gs` (nightly 23:45) | [schema-everhour.md](schema-everhour.md) |

---

## Apps Script files

| File | Binding | Purpose |
| --- | --- | --- |
| [apps-script.gs](apps-script.gs) | **Bound** to `quantified-self-log` | Webhook — receives POST from Shortcuts, appends to Log tab |
| [health-webhook.gs](health-webhook.gs) | **Bound** to `quantified-self-health` | Webhook — receives POST from the Health Sync shortcut, upserts by date |
| [todoist-sync.gs](todoist-sync.gs) | **Standalone** project `quantified-self-sync` | Main orchestrator & Overdue/Karma/Recurring syncs |
| [todoist-sync-utils.gs](todoist-sync-utils.gs) | **Standalone** project `quantified-self-sync` (same) | Shared HTTP, caching, and utility functions |
| [todoist-sync-completions.gs](todoist-sync-completions.gs) | **Standalone** project `quantified-self-sync` (same) | Completion sync logic + complexity extraction |
| [todoist-sync-sections.gs](todoist-sync-sections.gs) | **Standalone** project `quantified-self-sync` (same) | Section movement tracking ("In Review" sections) |
| [everhour-sync.gs](everhour-sync.gs) | **Standalone** project `quantified-self-sync` (same) | Nightly pull from Everhour API |

All files in the `quantified-self-sync` standalone project share the same Script Properties for credentials.

---

## Setup: `quantified-self-log`

1. Create new Google Sheet named `quantified-self-log`
2. Rename first tab to `Log`
3. Paste header row from [schema.md](schema.md) into row 1
4. Freeze row 1 (View → Freeze → 1 row)
5. **Extensions → Apps Script** → paste `apps-script.gs` → Save
6. **Deploy → New deployment** → Type: Web App → Execute as: Me → Access: Anyone → Deploy
7. Copy the Web App URL — paste into every Apple Shortcut

---

## Setup: `quantified-self-health`

1. Create `quantified-self-health` → tab named `Health` → paste header row from [schema-health.md](schema-health.md) → freeze row 1
2. **Extensions → Apps Script** → paste `health-webhook.gs` → Save
3. **Deploy → New deployment** → Web App → Execute as: Me → Access: Anyone → Deploy → copy the URL
4. Build the free **Health Sync** shortcut and paste that URL into it ([../shortcuts/health-sync.md](../shortcuts/health-sync.md)). Runs daily at 23:55 via a Time-of-Day automation — no third-party app needed.

---

## Setup: `quantified-self-todoist` and `quantified-self-everhour`

1. Create both sheets with tabs and headers from their schema files
2. In Google Apps Script console ([script.google.com](https://script.google.com)):
   - Create a **new standalone project** named `quantified-self-sync`
   - Add **five files** for Todoist (organized by concern):
     - `todoist-sync.gs` — main orchestrator, Overdue/Karma/Recurring syncs, diagnostics
     - `todoist-sync-utils.gs` — HTTP helpers, caching, utility functions (shared)
     - `todoist-sync-completions.gs` — completion sync logic, activity event normalization, complexity extraction
     - `todoist-sync-sections.gs` — section movement tracking ("In Review" for Fullsteam/Ascensus/Work)
   - Add `everhour-sync.gs` for Everhour integration
3. **Project Settings → Script Properties** — add:
   - `TODOIST_TOKEN` — from todoist.com → Settings → Integrations → Developer
   - `EVERHOUR_API_KEY` — from Everhour → My Profile → Settings → Application Access
   - `TODOIST_SPREADSHEET_ID` — from the sheet URL
   - `EVERHOUR_SPREADSHEET_ID` — from the sheet URL
4. **Triggers** → Add trigger:
   - `syncTodoist` — time-based — day timer — 11pm to midnight
   - `syncEverhour` — time-based — day timer — 11pm to midnight
5. Run diagnostic probes first, then manual sync:
   - Run `testTodoist()` first: probes all v1 API endpoints and logs response shapes; confirms section movements, completion events, and complexity extraction are available
   - Run `syncTodoist()` manually to authorize and do the first sync (will populate all tabs)
   - For Everhour, run `testEverhour()` then `syncEverhour()` for the same purpose

---

## Credential security

API tokens and spreadsheet IDs are **never stored in this repo**. They live only in Google Apps Script's Script Properties (encrypted at rest). Do not commit `.env` files or paste tokens into code.
