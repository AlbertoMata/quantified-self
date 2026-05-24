# quantified-self

Personal daily event and habit tracker with minimal interaction — built around Apple Watch, AirPods, Apple Shortcuts, Todoist, and Everhour. Centralized view in Obsidian.

## Goal

Track daily events and habits automatically or with the least friction possible, then surface analytics about behaviour patterns (mood vs sleep, caffeine vs focus, workouts vs HRV, habits vs karma, etc.).

See [docs/diagrams.md](docs/diagrams.md) for full architecture diagrams.

---

## Architecture

Four data sources feed into separate Google Sheets, blended in Looker Studio, and surfaced in Obsidian.

### Layer 1 — Zero effort (automatic)

| Source | Data |
|---|---|
| Apple Health | Steps, sleep stages, HRV, resting heart rate, blood oxygen, noise exposure |
| Apple Watch | Workouts, stand hours, activity rings |
| Everhour | Time entries synced nightly via Apps Script |
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

Looker Studio blends all four data sources on `date`. Obsidian surfaces the dashboard (Custom Frames embed) and auto-populates daily notes with yesterday's metrics each morning.

---

## Tech Stack

| Layer | Tool | Why |
|---|---|---|
| Capture (manual) | Apple Shortcuts | Native, free, Watch + Siri support |
| Capture (passive) | Health Auto Export | Writes Apple Health data to Sheets daily |
| Capture (productivity) | Todoist REST API v2 | Task completions, habits, karma |
| Capture (time) | Everhour API | Time entries, billable hours |
| Data store | Google Sheets (4 separate sheets) | Free, REST API, blendable in Looker Studio |
| Sync | Google Apps Script | Webhook for Shortcuts push; nightly pull for Todoist + Everhour |
| Analytics | Looker Studio | Free, blends all 4 sheets, real dashboards |
| Centralized view | Obsidian | Embedded dashboard + auto-populated daily notes |

---

## Repo Structure

```
quantified-self/
├── README.md
├── docs/
│   └── diagrams.md              # Mermaid architecture diagrams
├── shortcuts/
│   ├── README.md                # Setup guide + Watch + automations
│   ├── log-mood.md              # Log Mood shortcut
│   ├── log-event.md             # Log Event (generic menu)
│   ├── log-focus-block.md       # Start/End Focus block
│   └── morning-summary.md       # Morning Summary → Obsidian daily note
├── sheets/
│   ├── README.md                # All 4 sheets overview
│   ├── schema.md                # quantified-self-log schema
│   ├── schema-health.md         # quantified-self-health schema
│   ├── schema-todoist.md        # quantified-self-todoist schema (3 tabs)
│   ├── schema-everhour.md       # quantified-self-everhour schema (2 tabs)
│   ├── apps-script.gs           # Webhook for Shortcuts → Log sheet
│   ├── todoist-sync.gs          # Nightly Todoist pull (standalone GAS project)
│   └── everhour-sync.gs         # Nightly Everhour pull (same GAS project)
├── analytics/
│   └── README.md                # Looker Studio 4-source blend setup
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
2. Deploy `sheets/apps-script.gs` as a Web App — copy the URL
3. Install Apple Shortcuts from `shortcuts/` — paste the URL into each one
4. Assign Siri phrases and Watch complications (see `shortcuts/README.md`)
5. Connect `quantified-self-log` to Looker Studio

### Phase 1.5 — Health data

1. Create `quantified-self-health` in Google Sheets with a `Health` tab
2. Configure Health Auto Export (see `sheets/schema-health.md`)
3. Add as a data source in Looker Studio

### Phase 1.5 — Todoist + Everhour sync

1. Create `quantified-self-todoist` and `quantified-self-everhour` in Google Sheets
2. Create a standalone Apps Script project named `quantified-self-sync`
3. Paste `sheets/todoist-sync.gs` and `sheets/everhour-sync.gs` into the project
4. Set Script Properties: `TODOIST_TOKEN`, `EVERHOUR_API_KEY`, and both spreadsheet IDs
5. Set time-based triggers: `syncTodoist` at 23:30, `syncEverhour` at 23:45
6. Add both sheets as data sources in Looker Studio

### Phase 1.5 — Obsidian integration

1. Install Obsidian plugins: **Custom Frames**, **Periodic Notes**, **Templater**
2. Embed your Looker Studio report via Custom Frames (see `obsidian/README.md`)
3. Copy `obsidian/daily-note-template.md` into your vault's templates folder
4. Set up the Morning Summary Shortcut (see `shortcuts/morning-summary.md`)

---

## Roadmap

- [x] Phase 1: Shortcuts + Google Sheets + Looker Studio (MVP)
- [x] Phase 1.5: Health data export (Health Auto Export → Sheets)
- [x] Phase 1.5: Todoist sync (completions, habits, karma)
- [x] Phase 1.5: Everhour sync (time entries, daily summary)
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
| MVP data store | Google Sheets (4 sheets) | Free, no backend, blendable in Looker Studio |
| Sheet structure | Separate sheet per source | Independent permissions, clear ownership |
| MVP analytics | Looker Studio | Free, zero code, blends across sheets |
| Centralized view | Obsidian (Custom Frames + daily note) | Single place for dashboard + journaling |
| Sync method | Standalone Apps Script | One credential store, writes to multiple sheets |
| Dedup strategy | Stable API IDs (task_id, entry_id) | Survives late edits; date-based dedup would miss same-day re-completions |
| Manual events | ~5 categories | Start small, let data drive expansion |
| Auto events | Apple Health | Already collecting, no effort |
| Custom app language | SwiftUI | Native Watch support, Swift Charts |
| Custom backend | Supabase | PostgreSQL, open source, free tier |
