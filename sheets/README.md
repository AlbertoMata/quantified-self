# Sheets

Four Google Sheets, one per data source. Each is an independent spreadsheet — separate permissions, separate Apps Script deployments, but all blendable in Looker Studio on a shared `date` key.

---

## Spreadsheets

| Sheet name | Tabs | Populated by | Schema |
| --- | --- | --- | --- |
| `quantified-self-log` | `Log` | Apps Script webhook (push from Shortcuts) | [schema.md](schema.md) |
| `quantified-self-health` | `Health` | Health Auto Export app (daily 06:00) | [schema-health.md](schema-health.md) |
| `quantified-self-todoist` | `Completions`, `Overdue`, `KarmaStats` | `todoist-sync.gs` (nightly 23:30) | [schema-todoist.md](schema-todoist.md) |
| `quantified-self-everhour` | `TimeEntries`, `DailySummary` | `everhour-sync.gs` (nightly 23:45) | [schema-everhour.md](schema-everhour.md) |

---

## Apps Script files

| File | Binding | Purpose |
| --- | --- | --- |
| [apps-script.gs](apps-script.gs) | **Bound** to `quantified-self-log` | Webhook — receives POST from Shortcuts, appends to Log tab |
| [todoist-sync.gs](todoist-sync.gs) | **Standalone** project `quantified-self-sync` | Nightly pull from Todoist REST API v2 |
| [everhour-sync.gs](everhour-sync.gs) | **Standalone** project `quantified-self-sync` (same) | Nightly pull from Everhour API |

`todoist-sync.gs` and `everhour-sync.gs` live in the same standalone Apps Script project so all credentials are in one place (Script Properties).

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

1. Create `quantified-self-health` → tab named `Health`
2. Paste header row from [schema-health.md](schema-health.md)
3. Configure Health Auto Export app (full steps in schema-health.md)

---

## Setup: `quantified-self-todoist` and `quantified-self-everhour`

1. Create both sheets with tabs and headers from their schema files
2. In Google Apps Script console ([script.google.com](https://script.google.com)):
   - Create a **new standalone project** named `quantified-self-sync`
   - Add two files: paste `todoist-sync.gs` and `everhour-sync.gs`
3. **Project Settings → Script Properties** — add:
   - `TODOIST_TOKEN` — from todoist.com → Settings → Integrations → Developer
   - `EVERHOUR_API_KEY` — from Everhour → My Profile → Settings → Application Access
   - `TODOIST_SPREADSHEET_ID` — from the sheet URL
   - `EVERHOUR_SPREADSHEET_ID` — from the sheet URL
4. **Triggers** → Add trigger:
   - `syncTodoist` — time-based — day timer — 11pm to midnight
   - `syncEverhour` — time-based — day timer — 11pm to midnight
5. Run each function once manually from the editor to authorize and do the first sync

---

## Credential security

API tokens and spreadsheet IDs are **never stored in this repo**. They live only in Google Apps Script's Script Properties (encrypted at rest). Do not commit `.env` files or paste tokens into code.
