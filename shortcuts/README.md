# Shortcuts Setup Guide

Full walkthrough for the Apple Shortcuts → Google Sheets pipeline.

---

## Prerequisites

- iPhone with Shortcuts app (iOS 16+)
- Apple Watch paired
- AirPods (any generation)
- Google account

---

## Shortcuts

| File | Siri phrase | Purpose |
|---|---|---|
| [log-mood.md](log-mood.md) | "Log mood" | Rate mood 1–5 |
| [log-event.md](log-event.md) | "Log event" | Generic event logger with menu |
| [log-focus-block.md](log-focus-block.md) | "Start focus" / "End focus" | Time focus blocks |

---

## Google Apps Script webhook

The Apps Script (`../sheets/apps-script.gs`) is the glue between Shortcuts and your Sheet. It receives a POST request and appends a row.

### Deploy steps

1. Open your `quantified-self-log` Google Sheet
2. Go to **Extensions → Apps Script**
3. Delete any existing code and paste the contents of `sheets/apps-script.gs`
4. Save (Cmd+S)
5. Click **Deploy → New deployment**
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Click **Deploy** → authorize when prompted
7. Copy the **Web app URL** — paste this into every Shortcut

> **Security note**: the URL is a secret — anyone with it can write to your sheet. Don't commit it to the repo.

---

## Add to Apple Watch

For each shortcut you want on the Watch:

1. Open the **Shortcuts** app on iPhone
2. Long-press the shortcut → **Share** → **Add to Apple Watch**
3. On Watch: press and hold watch face → **Edit** → scroll to a complication slot
4. Choose **Shortcuts** → pick your shortcut
5. Tap the complication = runs the shortcut instantly

**Tip**: Put your most-used event (e.g. Log Mood) as the main complication on your daily watch face. One tap + crown confirm = done in 3 seconds.

---

## Automate with triggers (zero interaction)

Some events can log themselves via Shortcuts automations:

| Trigger | Automation |
|---|---|
| **Morning alarm is dismissed** | Log "wake_up" with current time |
| **Arrive home** (geofence) | Log "arrived_home" |
| **Leave home** (geofence) | Log "left_home" |
| **Workout detected** | Apple Health handles this natively |
| **Connect to car Bluetooth** | Log "commute_start" |
| **Low Power Mode enabled** | Log "battery_low" (proxy for long day) |

To create: Shortcuts app → **Automation** tab → **+** → Personal Automation.

---

## Test your pipeline

```bash
# Quick test from terminal (replace URL with yours)
curl -X POST "YOUR_APPS_SCRIPT_URL" \
  -H "Content-Type: application/json" \
  -d '{"event_type":"test","value":"hello","source":"curl"}'

# Expected response:
# {"status":"ok"}
```

Check your Sheet — a new row should appear within a few seconds.

---

## Troubleshooting

| Issue | Fix |
|---|---|
| Shortcut fails silently | Add a [Show Result] step after the URL action to see the response |
| Sheet not found | Make sure the tab is named exactly `Log` (case-sensitive) |
| 401 / permission error | Re-deploy the Apps Script and re-authorize |
| Siri doesn't trigger | Go to Settings → Siri & Search → find the shortcut → toggle on |
| Watch complication missing | Open Watch app on iPhone → Shortcuts → enable the shortcut |
