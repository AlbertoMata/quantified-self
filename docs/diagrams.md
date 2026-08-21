# Architecture Diagrams

---

## 1. System Architecture

End-to-end view of all data sources, sync layers, storage, and analytics.

```mermaid
flowchart TD
    subgraph Capture["Data Capture"]
        SC["Apple Shortcuts\nMood · Focus · Events"]
        AW["Apple Health / Watch\nHealth Sync shortcut"]
        TD["Todoist\nAPI v1"]
        EH["Everhour\nREST API"]
    end

    subgraph Sync["Sync Layer"]
        WH["Apps Script Webhook\napps-script.gs\n(push — always on)"]
        HW["Apps Script Webhook\nhealth-webhook.gs\n(push — nightly 23:55)"]
        GAS["Apps Script Sync\ntodoist-sync.gs\neverhour-sync.gs\n(nightly trigger)"]
    end

    subgraph Storage["Google Sheets Storage"]
        SL[("quantified-self-log\nLog")]
        SH[("quantified-self-health\nHealth")]
        ST[("quantified-self-todoist\nCompletions · Overdue · KarmaStats\nRecurringStatus · HabitDaily")]
        SE[("quantified-self-everhour\nTimeEntries · DailySummary")]
    end

    subgraph Analytics["Analytics & Centralized View"]
        LS["Looker Studio\nBlended dashboard"]
        OB["Obsidian\nCustom Frames embed\n+ Daily Note summary"]
    end

    SC -->|POST JSON| WH --> SL
    AW -->|nightly POST JSON| HW --> SH
    GAS -->|pull & upsert| TD
    GAS -->|pull & upsert| EH
    GAS --> ST
    GAS --> SE

    SL --> LS
    SH --> LS
    ST --> LS
    SE --> LS

    LS -->|iframe embed| OB
    GAS -->|morning Shortcut\nwrites markdown| OB
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

## 3. Todoist / Everhour Nightly Pull Pipeline

How external productivity data is fetched and stored each night.

```mermaid
sequenceDiagram
    participant TR as Time Trigger (23:30 / 23:45)
    participant GAS as Apps Script Sync
    participant SP as Script Properties (token store)
    participant API as External API (Todoist / Everhour)
    participant SH as Target Sheet

    TR->>GAS: syncTodoist() / syncEverhour()
    GAS->>SP: Read API token + last sync timestamp
    GAS->>API: GET /tasks/completed/by_completion_date + /activities (paginated, since lastSync)
    API-->>GAS: Completed tasks + recurring check-off events
    GAS->>SH: Read existing dedup keys → Set
    GAS->>GAS: Drop already-seen task_id + completed_at pairs
    GAS->>SH: appendRows(new completions)
    GAS->>SP: Write new lastSync timestamp
    GAS->>SH: Replace Overdue and RecurringStatus snapshots · upsert KarmaStats / DailySummary
    GAS->>SH: Rebuild HabitDaily grid from Completions + RecurringStatus (sheet-to-sheet)
```

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
    SC->>GS: Read DailySummary, KarmaStats, Log (yesterday)
    GS-->>SC: JSON with metrics
    SC->>SC: Format markdown snippet\n(mood avg, sleep, habits, hours worked)
    SC->>MF: Write/append to YYYY-MM-DD.md in vault
    OB->>MF: Reads file (vault is iCloud-synced)
    Note over OB: Templater fills template\nLooker Studio embedded via Custom Frames
```
