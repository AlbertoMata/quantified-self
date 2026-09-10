# Architecture Diagrams

Index of what writes what: [sheets.md](sheets.md). The migration off Apps Script is planned in
[plans/typescript-port.md](plans/typescript-port.md).

---

## 1. System Architecture

End-to-end view of all data sources, sync layers, storage, and analytics. Dashed nodes are not
live — Everhour is retired and TrackingTime is not built. Both are covered in
[`../trackingtime/`](../trackingtime/README.md).

```mermaid
flowchart TD
    subgraph Capture["Data Capture"]
        SC["Apple Shortcuts\nMood · Focus · Events"]
        AW["Apple Health / Watch\nHealth Sync shortcut"]
        TD["Todoist\nAPI v1"]
        TT["TrackingTime\nnot built"]
        EH["Everhour\nretired"]
    end

    subgraph Sync["Sync Layer"]
        WH["Apps Script Webhook\nevent-log/apps-script.gs\n(push — always on)"]
        HW["Apps Script Webhook\nhealth — code deleted,\npending rework"]
        GAS["Apps Script Sync\ntodoist/*.gs — 10 files\n(nightly 23:30 + hourly 07:00–23:00)"]
    end

    subgraph Storage["Google Sheets Storage"]
        SL[("quantified-self-log\nLog")]
        SH[("quantified-self-health\nHealth")]
        ST[("quantified-self-todoist\nCompletions · Overdue · KarmaStats\nRecurringStatus · HabitDaily\nBillCycle · AreaDaily · TaskDaily")]
        SE[("quantified-self-everhour\nTimeEntries · DailySummary\nhistorical — no longer written")]
    end

    subgraph Analytics["Analytics & Centralized View"]
        LS["Looker Studio\nBlended dashboard"]
        OB["Obsidian\nCustom Frames embed\n+ Daily Note summary"]
    end

    SC -->|POST JSON| WH --> SL
    AW -->|nightly POST JSON| HW --> SH
    GAS -->|pull| TD
    GAS --> ST
    TT -.->|future| Sync
    EH -.-> SE

    SL --> LS
    SH --> LS
    ST --> LS
    SE -.->|frozen| LS

    LS -->|iframe embed| OB
    GAS -->|morning Shortcut\nwrites markdown| OB

    classDef inactive stroke-dasharray:5 5,opacity:0.6
    class TT,EH,SE,HW inactive
```

---

## 2. Shortcuts Push Pipeline

How a manual event travels from a Siri phrase to a row in Google Sheets.

```mermaid
sequenceDiagram
    participant U as User (Siri / Watch tap)
    participant SC as Apple Shortcut
    participant WH as Apps Script Webhook
    participant SL as quantified-self-log

    U->>SC: Trigger ("Log mood" / Watch complication)
    SC->>SC: Show menu / ask input
    SC->>SC: Build JSON payload\n{event_type, value, notes, source}
    SC->>WH: POST /exec (HTTPS)
    WH->>WH: Parse JSON · set defaults · get timestamp
    WH->>SL: appendRow([timestamp, event_type, value, notes, source])
    WH-->>SC: {"status": "ok"}
    SC->>U: Speak "Logged" via AirPods
```

---

## 3. Todoist Pull Pipeline

How Todoist data is fetched and stored. `syncTodoist()` runs the eight steps in isolation and
aggregates failures, so one dead endpoint cannot abort the rest.

```mermaid
sequenceDiagram
    participant TR as Time Trigger (23:30 nightly, hourly 07:00–23:00)
    participant GAS as Apps Script Sync
    participant SP as Script Properties (token + cursor)
    participant API as Todoist API v1
    participant SH as quantified-self-todoist

    TR->>GAS: syncTodoist() / syncTodoistIntraday()
    GAS->>SP: Read API token + last sync timestamp
    GAS->>API: GET /tasks/completed/by_completion_date + /activities (paginated, since lastSync)
    API-->>GAS: Completed tasks + recurring check-off events
    GAS->>SH: Read existing dedup keys → Set
    GAS->>GAS: Drop already-seen task_id + completed_at pairs
    GAS->>SH: appendRows(new completions)
    GAS->>SP: Write new lastSync timestamp
    GAS->>SH: Replace today's Overdue · RecurringStatus · AreaDaily · TaskDaily snapshots
    GAS->>SH: Upsert KarmaStats · rebuild BillCycle
    GAS->>SH: Rebuild HabitDaily from Completions + RecurringStatus (sheet-to-sheet, runs last)
```

**Ordering is load-bearing.** `HabitDaily` is derived from two other tabs and must run last;
`BillCycle` and `AreaDaily` read `Completions` and so must follow it. `TaskDaily` and
`AreaDaily`'s snapshot columns are *observed only* — a missed day is a permanent hole no re-run
can fill.

A separate morning trigger runs `checkBillRisk()` around 08:00: a 23:30 warning about a bill due
that same day is useless.

---

## 4. Obsidian Integration

How the centralized Obsidian view is populated each morning.

```mermaid
sequenceDiagram
    participant AL as Morning Alarm (dismissed)
    participant SC as Apple Shortcut (automation)
    participant GS as Google Sheets API
    participant MF as Markdown file\n(iCloud / Obsidian vault)
    participant OB as Obsidian Daily Note

    AL->>SC: Alarm dismissed trigger
    SC->>GS: Read KarmaStats, HabitDaily, Log (yesterday)
    GS-->>SC: JSON with metrics
    SC->>SC: Format markdown snippet\n(mood avg, sleep, habits, karma)
    SC->>MF: Write/append to YYYY-MM-DD.md in vault
    OB->>MF: Reads file (vault is iCloud-synced)
    Note over OB: Templater fills template\nLooker Studio embedded via Custom Frames
```

The morning summary previously read `DailySummary` for hours worked. That tab is no longer
written — see [`../shortcuts/morning-summary.md`](../event-log/shortcuts/morning-summary.md), which needs
the same correction once a time tracker is back in place.
