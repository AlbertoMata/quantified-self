# Event log → Sheets

Google Sheet: `quantified-self-log` · Tab: `Log` · Schema: [schema.md](schema.md)

The manual-capture path: every Apple Shortcut that records a mood, a coffee, a focus block or a
one-off event POSTs a timestamped row to one Web App, and [`apps-script.gs`](apps-script.gs)
appends it. This is the lowest-friction surface in the project — Siri from AirPods, or one tap
on a Watch complication.

**Append-only.** Unlike the health webhook, there is no upsert: two coffees an hour apart are
two real events, and the timestamp is what distinguishes them.

The shortcuts that write here are documented in [`../shortcuts/`](shortcuts/README.md) —
[`log-mood.md`](shortcuts/log-mood.md) and [`log-event.md`](shortcuts/log-event.md).

## Setup

1. Create `quantified-self-log` with a tab named `Log`
2. Paste the header row from [schema.md](schema.md) into row 1, then freeze row 1
3. **Extensions → Apps Script** → paste [`apps-script.gs`](apps-script.gs) → Save
4. **Deploy → New deployment** → Web App → Execute as: Me → Access: Anyone → Deploy
5. Copy the Web App URL and paste it into **every** Apple Shortcut that logs an event
6. Add the sheet as a Looker Studio data source

Bound to its spreadsheet, so no spreadsheet ID and no Script Properties are needed.
