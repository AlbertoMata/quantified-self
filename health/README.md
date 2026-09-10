# Health → Sheets

Google Sheet: `quantified-self-health` · Tab: `Health` · Schema: [schema.md](schema.md)

**Status: no code in this repo.** The webhook that used to live here (`health-webhook.gs`) has
been **deleted pending a rework**. What remains is the schema — the contract any replacement
must satisfy — and this note.

## What the integration did, and will do again

Apple Health metrics landed here once a night. The "Health Sync" Apple Shortcut reads Health
natively at 23:55 and POSTs a single JSON row to a bound Apps Script Web App, which **upserts by
date**: re-running the shortcut for the same day replaces that day's row instead of duplicating
it, so a manual re-run after a missed automation is safe. No third-party app, no subscription.

The shortcut half still exists and is unchanged:
[`../event-log/shortcuts/health-sync.md`](../event-log/shortcuts/health-sync.md).

## Recovering the old implementation

The deleted webhook is one command away if the rework should start from it rather than from
scratch:

```sh
git show b55def6:sheets/health-webhook.gs
```

## Constraints the rework inherits

| Constraint | Why |
| --- | --- |
| **Stays an Apps Script Web App** | Apple Shortcuts need a URL to POST to. A scheduled GitHub Actions job has no inbound endpoint, so this cannot follow the Todoist sync onto Actions — see [`../docs/plans/typescript-port.md`](../docs/plans/typescript-port.md) |
| **Bound to the spreadsheet, not standalone** | `SpreadsheetApp.getActiveSpreadsheet()` resolves to its container, so it needs no spreadsheet ID and no Script Properties — one less credential to manage |
| **Upsert by date** | The whole point. An append-only version silently duplicates every re-run |
| **Column order must match [schema.md](schema.md)** | The payload is positional once it reaches the sheet; a reordered header corrupts every row written after it |

## Setup, once there is code again

1. Create `quantified-self-health` with a tab named `Health`
2. Paste the header row from [schema.md](schema.md) into row 1, then freeze row 1
   (View → Freeze → 1 row)
3. **Extensions → Apps Script** → add the reworked webhook → Save
4. **Deploy → New deployment** → Web App → Execute as: Me → Access: Anyone → Deploy → copy
   the URL
5. Build the **Health Sync** shortcut and paste that URL into it
   ([`../event-log/shortcuts/health-sync.md`](../event-log/shortcuts/health-sync.md)). Set a
   daily 23:55 Time-of-Day automation
6. Add the sheet as a Looker Studio data source
