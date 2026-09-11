# Google Sheets — the data stores

One spreadsheet per data source. Each is independent — separate permissions, separate Apps
Script deployment — but all blendable in Looker Studio on a shared `date` key.

Each integration lives in its own top-level directory and owns its own setup instructions.
This page is only the index: which spreadsheet exists, who writes it, and where its schema is.

---

## Spreadsheets

| Sheet name | Tabs | Written by | Status |
| --- | --- | --- | --- |
| `quantified-self-log` | `Log` | [`event-log/`](../event-log/README.md) — webhook, pushed from Shortcuts | Active |
| `quantified-self-health` | `Health` | [`health/`](../health/README.md) — webhook **deleted pending rework**; the shortcut still posts | Paused |
| `quantified-self-todoist` | `Completions`, `Overdue`, `KarmaStats`, `RecurringStatus`, `HabitDaily`, `BillCycle`, `AreaDaily`, `TaskDaily` | [`todoist/`](../todoist/README.md) — nightly 23:30 + hourly 07:00–23:00 | Active |
| `quantified-self-everhour` | `TimeEntries`, `DailySummary` | Nothing, any more | **Historical** — Everhour is retired; its schema is recoverable from git, see [`trackingtime/`](../trackingtime/README.md) |
| *time tracking, future* | *undecided* | [`trackingtime/`](../trackingtime/README.md) | **Not built** |

---

## Apps Script projects

**Four projects, not one.** An earlier version of this page described a single standalone
project named `quantified-self-sync` holding both the Todoist and Everhour code. That was never
true — pulling the live projects with clasp (see
[`plans/typescript-port.md`](plans/typescript-port.md#what-the-a3-pull-found)) showed two
separate standalone projects with separate scopes and separate Script Properties.

| Project | Binding | Contents |
| --- | --- | --- |
| *Quantified Self - Todoist Sync* | Standalone | The ten `todoist/legacy-implementation/*.gs` files, sharing one flat global scope |
| *Quantified Self - Everhour Sync* | Standalone | One file. **Retired** — repo copy deleted, but the live trigger is still firing and needs disabling: [`trackingtime/`](../trackingtime/README.md) |
| Log webhook | Bound to `quantified-self-log` | [`event-log/apps-script.gs`](../event-log/apps-script.gs) |
| Health webhook | Bound to `quantified-self-health` | **Code deleted pending rework** — see [`health/`](../health/README.md) |

Deployment is moving from copy-paste to `clasp push` — see
[`plans/typescript-port.md`](plans/typescript-port.md), Phase A.

---

## Credential security

API tokens and spreadsheet IDs are **never stored in this repo**. They live only in Apps
Script's Script Properties (encrypted at rest), and — once the port reaches GitHub Actions — in
GitHub Secrets. Do not commit `.env` files or paste tokens into code.

Script Properties are **per project**, not per file. Two standalone projects means two separate
credential stores, which is why the Todoist and Everhour projects never shared a token.
