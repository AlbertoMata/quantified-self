# Obsidian Integration

Two complementary integrations that make Obsidian your centralized daily view:

| Integration | What it does |
|---|---|
| **Option A — Custom Frames embed** | Looker Studio dashboard lives inside an Obsidian panel — interactive charts, always live |
| **Option C — Daily Note summary** | A morning Shortcut writes yesterday's metrics as a markdown snippet into your daily note |

Use both together: the daily note gives you a scannable text summary at the top, the embedded dashboard gives you full interactivity below.

---

## Option A — Embed Looker Studio via Custom Frames

### Install the plugin

1. In Obsidian: **Settings → Community plugins → Browse**
2. Search for **Custom Frames** → Install → Enable
3. Go to **Settings → Custom Frames**

### Add your Looker Studio report

1. Click **Add frame**
2. **Name**: `Quantified Self`
3. **URL**: paste your Looker Studio report's **embed link**
   - In Looker Studio: **File → Embed report** → copy the embed URL (not the share URL)
   - It looks like: `https://lookerstudio.google.com/embed/reporting/<ID>/page/<PAGE_ID>`
4. **Open in**: Desktop browser pane (recommended) or Mobile browser
5. **Disable find in frame**: ON (avoids accidental keyboard shortcuts)
6. Save

### Access it

- Command palette: `Custom Frames: Open Quantified Self`
- Or assign a hotkey in **Settings → Hotkeys** → search `Custom Frames`
- Or add it to the left sidebar ribbon

> **Tip**: In Looker Studio, set the report date range to "Last 30 days" as the default so the embed always shows recent data without interaction.

---

## Option C — Daily Note auto-populated with metrics

### How it works

Each morning when you dismiss your alarm, an Apple Shortcut automatically:
1. Reads yesterday's data from your four Google Sheets
2. Formats a markdown metrics block
3. Writes it into a daily note file (`YYYY-MM-DD.md`) in your Obsidian vault (via iCloud Drive)

Your Obsidian daily note template (see `daily-note-template.md`) includes a placeholder that Templater fills in — the Shortcut writes the actual data file, and Templater reads a shared iCloud file to inject the metrics.

### Prerequisites

- Obsidian vault stored in **iCloud Drive** (default for iOS Obsidian app)
- Community plugins: **Templater** + **Periodic Notes**
- Apple Shortcuts app with the `Morning Summary` shortcut (see `shortcuts/morning-summary.md`)

### Setup

#### 1. Install and configure Periodic Notes

1. **Settings → Community plugins → Browse** → install **Periodic Notes** → Enable
2. **Settings → Periodic Notes**:
   - Daily notes: **ON**
   - Format: `YYYY-MM-DD`
   - Template file: `templates/daily-note.md` (create this path in your vault)
   - Folder: (leave blank or set to `Daily Notes/`)

#### 2. Install and configure Templater

1. Install **Templater** → Enable
2. **Settings → Templater**:
   - Template folder location: `templates`
   - Enable **Trigger Templater on new file creation**: ON
   - Enable **Automatic jump to cursor**: ON (optional)

#### 3. Copy the daily note template

Copy the contents of `obsidian/daily-note-template.md` from this repo into your vault at `templates/daily-note.md`.

#### 4. Set up the Morning Summary Shortcut

See `shortcuts/morning-summary.md` for the full Shortcut steps. In summary:
- Triggered by: alarm dismissed (Personal Automation)
- Reads: Google Sheets API for yesterday's metrics
- Writes: a markdown file to `iCloud Drive/Obsidian/<vault-name>/_qs-summary.md`

Templater's `tp.file.include()` in the daily note template reads `_qs-summary.md` and injects it into the note.

#### 5. Test

1. Run the Shortcut manually (tap it in the Shortcuts app)
2. Open Obsidian → open or create today's daily note (Cmd+T or via Periodic Notes)
3. The metrics block should appear at the top of the note

---

## File layout in this repo

```
obsidian/
├── README.md                  ← this file
└── daily-note-template.md     ← Templater template to copy into your vault
```

The Shortcut that writes the metrics is documented in `shortcuts/morning-summary.md`.
