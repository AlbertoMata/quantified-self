# quantified-self

Personal daily event and habit tracker with minimal interaction — built around Apple Watch, AirPods, Apple Shortcuts, and Todoist. Centralized view in Obsidian.

## Goal

Track daily events and habits automatically or with the least friction possible, then surface analytics about behaviour patterns (mood vs sleep, caffeine vs focus, workouts vs HRV, habits vs karma, etc.).

See [docs/diagrams.md](docs/diagrams.md) for full architecture diagrams.

---

## Architecture

Each data source feeds its own Google Sheet, blended in Looker Studio and surfaced in Obsidian. Every integration lives in its own top-level directory; [docs/sheets.md](docs/sheets.md) is the index.

### Layer 1 — Zero effort (automatic)

| Source | Data |
|---|---|
| Apple Health | Steps, sleep, HRV, resting heart rate, blood oxygen, noise exposure — via a free nightly Shortcut |
| Apple Watch | Workouts, stand hours, activity rings |
| Time tracking | *Between tools* — Everhour is [retired](trackingtime/README.md); [TrackingTime](trackingtime/README.md) is not built yet |
| Todoist | Task completions, habit streaks, karma — synced nightly |

### Layer 2 — Minimal interaction (AirPods + Watch)

Apple Shortcuts triggered via Siri or a Watch complication tap. Each shortcut writes a timestamped row to `quantified-self-log`.

- Mood (1–5 scale)
- Food quality (1–5 or categorical)
- Caffeine intake (yes/no or count)
- Focus block start/end
- Social interaction (yes/no)
- Custom one-off events

### Layer 3 — Analytics & Centralized View

Looker Studio blends the data sources on `date`. Obsidian surfaces the dashboard (Custom Frames embed) and auto-populates daily notes with yesterday's metrics each morning.

---

## Tech Stack

| Layer | Tool | Why |
|---|---|---|
| Capture (manual) | Apple Shortcuts | Native, free, Watch + Siri support |
| Capture (passive) | Apple Shortcuts (native Health actions) | Free "Health Sync" shortcut reads Apple Health and POSTs a daily row — no paid app |
| Capture (productivity) | Todoist API v1 (unified) | Task completions, habits, karma |
| Capture (time) | TrackingTime — **not built** | Replaces Everhour. See [trackingtime/](trackingtime/README.md) |
| Data store | Google Sheets, one per source | Free, REST API, blendable in Looker Studio |
| Sync | Google Apps Script, moving to TypeScript + clasp | Webhooks for Shortcuts push; nightly pull for Todoist. See [the port plan](docs/plans/typescript-port.md) |
| Analytics | Looker Studio | Free, blends every sheet on `date`, real dashboards |
| Centralized view | Obsidian | Embedded dashboard + auto-populated daily notes |

---

## Repo Structure

```
quantified-self/
├── README.md
├── docs/
│   ├── diagrams.md              # Mermaid architecture diagrams
│   ├── sheets.md                # Index: which spreadsheet, written by whom
│   ├── plans/
│   │   ├── habits-dashboard.md  # Looker Habits page: design + required sheet changes
│   │   ├── life-areas.md        # Areas + bill cycles: Todoist → Sheets → scripts → reports
│   │   └── typescript-port.md   # Port off Apps Script: clasp + TS, then GH Actions
│   └── todoist/
│       └── architecture.md      # Todoist scripts: structure, functions, edge cases
├── event-log/shortcuts/
│   ├── README.md                # Setup guide + Watch + automations
│   ├── log-mood.md              # Log Mood shortcut
│   ├── log-event.md             # Mark core + per-event wrappers (Siri one-shot)
│   ├── health-sync.md           # Nightly Apple Health → webhook (free, native)
│   ├── generate-health-sync.py  # Generates an importable health-sync.shortcut scaffold
│   └── morning-summary.md       # Morning Summary → Obsidian daily note
├── todoist/                     # Todoist → Sheets. The largest integration by far
│   ├── README.md                # Index: 8 tabs, script map, Script Properties
│   ├── *.gs                     # 10 files, one Apps Script project, one flat scope
│   ├── schema/                  # One doc per tab — the contract, not a description
│   ├── habits-contract.md       # habits/sub-habits labels, adding a step
│   ├── area-contract.md         # area-* labels, the project tree, what makes a bill
│   ├── history.md               # Dated caveats for reading old rows
│   ├── looker/                  # Looker Studio specs: blends, page recipes, palettes
│   └── ts/                      # TypeScript port in progress (npm workspace)
├── health/                      # Apple Health → Sheets
│   ├── README.md  schema.md   # webhook deleted pending rework
├── event-log/                   # Shortcuts → Sheets (mood, food, caffeine, focus)
│   ├── README.md  apps-script.gs  schema.md
│   └── shortcuts/               # Every Apple Shortcut: setup, Watch, automations
├── trackingtime/                # Not built. Replaces the retired Everhour integration
│   └── README.md                # Open questions + the live trigger still to disable
├── obsidian/
│   ├── README.md                # Custom Frames + daily note integration guide
│   └── daily-note-template.md   # Templater template (copy into your vault)
└── app/                         # Phase 2: SwiftUI app (placeholder)
    └── .gitkeep
```

---

## Setup

### Phase 1 — Shortcuts + Log sheet (manual events)

1. Create `quantified-self-log` in Google Sheets with a `Log` tab
2. Deploy `event-log/apps-script.gs` as a Web App — copy the URL
3. Install Apple Shortcuts from `event-log/shortcuts/` — paste the URL into each one
4. Assign Siri phrases and Watch complications (see `event-log/shortcuts/README.md`)
5. Connect `quantified-self-log` to Looker Studio

### Phase 1.5 — Health data (free, native)

1. Create `quantified-self-health` in Google Sheets with a `Health` tab
2. *(Webhook code deleted pending rework — see [health/README.md](health/README.md))*
3. Build the **Health Sync** shortcut, paste the URL, and set a daily 23:55 automation (see `event-log/shortcuts/health-sync.md`)
4. Add as a data source in Looker Studio

### Phase 1.5 — Todoist sync

1. Create `quantified-self-todoist` in Google Sheets
2. Create a standalone Apps Script project (the live one is named *Quantified Self - Todoist Sync*)
3. Paste the ten `todoist/*.gs` files into the project
4. Set Script Properties: `TODOIST_TOKEN` and `TODOIST_SPREADSHEET_ID`
5. Set time-based triggers: `syncTodoist` at 23:30, `syncTodoistIntraday` hourly (it
   self-limits to 07:00–23:00, keeping today's habit grid current), and `checkBillRisk` each
   morning (~08:00 — a 23:30 warning about a bill due that day is useless)
6. Add the sheet as a data source in Looker Studio

### Phase 1.5 — Obsidian integration

1. Install Obsidian plugins: **Custom Frames**, **Periodic Notes**, **Templater**
2. Embed your Looker Studio report via Custom Frames (see `obsidian/README.md`)
3. Copy `obsidian/daily-note-template.md` into your vault's templates folder
4. Set up the Morning Summary Shortcut (see `event-log/shortcuts/morning-summary.md`)

---

## Roadmap

- [x] Phase 1: Shortcuts + Google Sheets + Looker Studio (MVP)
- [x] Phase 1.5: Health data export (free native Shortcut → webhook → Sheets)
- [x] Phase 1.5: Todoist sync (completions, habits, karma)
- [x] ~~Phase 1.5: Everhour sync~~ — retired, superseded by TrackingTime
- [ ] TrackingTime sync (time entries) — replaces Everhour, not started
- [ ] Port the sync jobs to TypeScript + clasp, then GitHub Actions ([plan](docs/plans/typescript-port.md))
- [x] Phase 1.5: Obsidian — embedded Looker Studio dashboard
- [x] Phase 1.5: Obsidian — auto-populated daily note (morning Shortcut)
- [ ] Phase 2: SwiftUI Watch app with native complication
- [ ] Phase 2: Supabase backend (migrate from Sheets)
- [ ] Phase 2: In-app Swift Charts dashboard
- [ ] Phase 3: Correlations engine (sleep quality vs next-day mood, habits vs karma)
- [ ] Phase 3: Weekly digest notification

---

## Key Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Primary input | AirPods (Siri) + Apple Watch | Least friction, always with you |
| MVP data store | Google Sheets, one per source | Free, no backend, blendable in Looker Studio |
| Sheet structure | Separate sheet per source | Independent permissions, clear ownership |
| MVP analytics | Looker Studio | Free, zero code, blends across sheets |
| Time tracking | Everhour → TrackingTime | Everhour is no longer the tool in use. Its code is deleted and its history left in the spreadsheet; the schema is recoverable from git |
| Repo layout | One top-level directory per integration | `sheets/` described the destination, not the thing; every source now owns its code, schema and setup in one place |
| Centralized view | Obsidian (Custom Frames + daily note) | Single place for dashboard + journaling |
| Sync method | Standalone Apps Script, porting to TypeScript | Script Properties are per project, so each project is its own credential store |
| Dedup strategy | Stable API IDs (task_id, entry_id) | Survives late edits; date-based dedup would miss same-day re-completions |
| Manual events | ~5 categories | Start small, let data drive expansion |
| Auto events | Apple Health | Already collecting, no effort |
| Health capture | Native Shortcut + webhook (not Health Auto Export) | Free — paid app's only advantage is background reliability; a nightly automation is enough |
| Custom app language | SwiftUI | Native Watch support, Swift Charts |
| Custom backend | Supabase | PostgreSQL, open source, free tier |
