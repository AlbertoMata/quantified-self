# Shortcut: Health Sync

A free, native replacement for the paid Health Auto Export app. It reads Apple Health with the
built-in **Find Health Samples** + **Calculate Statistics** actions and POSTs one daily row to
the [health-webhook.gs](../sheets/health-webhook.gs) Apps Script web app, which upserts it into
`quantified-self-health` by `date`.

Runs unattended once a day via a **Time-of-Day automation** at **23:55** — after the Todoist
(23:30) and Everhour (23:45) pulls, and late enough that the day's activity is complete and
last night's sleep (recorded this morning) is in HealthKit.

> Importable file: run `python3 generate-health-sync.py` → `generated/health-sync.shortcut`.
> It imports a **wired scaffold** — date, the JSON Dictionary, and the POST (with the webhook-URL
> prompt) are done; the 11 Health reads are inline `>> ADD` comments you fill in. See the note
> at the bottom.

---

## What it captures

| Variable → JSON key | Health source | Aggregation |
|---|---|---|
| `steps` | Steps | Find Health Samples → **Sum** |
| `active_calories` | Active Energy | Find Health Samples → **Sum** |
| `resting_hr_bpm` | Resting Heart Rate | Find Health Samples → **Average** |
| `hrv_ms` | Heart Rate Variability | Find Health Samples → **Average** |
| `blood_oxygen_pct` | Blood Oxygen Saturation | Find Health Samples → **Average** |
| `noise_exposure_db` | Environmental Sound Levels | Find Health Samples → **Average** |
| `sleep_hours` | Sleep Analysis (`Asleep`) | Repeat-sum durations → hours |
| `mindful_minutes` | Mindful Session | Repeat-sum durations → minutes |
| `workout_minutes` | Workouts (Find Workouts) | Repeat-sum durations → minutes |
| `stand_hours` | Apple Stand Hour | **Count** of samples |
| `date`, `exported_at` | Current Date | formatted |

---

## Build steps

### 1. Date

```text
1. [Date] Current Date
2. [Format Date]  Date Format: Custom → "yyyy-MM-dd"   → [Set Variable] "date"
```

### 2. Scalar metrics (repeat this 6-action pattern per metric)

```text
[Find Health Samples]
   - Sample Type: Steps          (then: Active Energy, Resting Heart Rate,
   - Where: Start Date  is today  Heart Rate Variability, Blood Oxygen, Environmental Sound Levels)
[Calculate Statistics]
   - Operation: Sum  (Steps, Active Energy)  /  Average  (the other four)
   - over: Health Sample Values
[Set Variable]  → steps / active_calories / resting_hr_bpm / hrv_ms / blood_oxygen_pct / noise_exposure_db
```

> If a metric has no samples for the day, Calculate Statistics returns nothing — set the
> variable from an `If [no value] → 0` or just let it POST empty (the webhook stores `""`).

### 3. Sleep (total hours, last-night range)

```text
[Find Health Samples]
   - Sample Type: Sleep Analysis
   - Category is "Asleep"  (any asleep stage)
   - Where: Start Date is in the last 18 hours   ← catches the overnight block
[Set Variable] "sleep_seconds" = 0
[Repeat with Each] (item = each sleep sample)
   - [Get Details of Health Sample] → Duration  (seconds)
   - [Calculate] sleep_seconds + Duration → [Set Variable] "sleep_seconds"
[End Repeat]
[Calculate] sleep_seconds ÷ 3600 → [Set Variable] "sleep_hours"
```

### 4. Mindful minutes

```text
[Find Health Samples] Sample Type: Mindful Session, Start Date is today
[Set Variable] "mindful_seconds" = 0
[Repeat with Each]  → Duration → accumulate into mindful_seconds
[Calculate] mindful_seconds ÷ 60 → [Set Variable] "mindful_minutes"
```

### 5. Workout minutes

```text
[Find Workouts]  Where: Start Date is today
[Set Variable] "workout_seconds" = 0
[Repeat with Each]  → [Get Details of Workout] Duration → accumulate
[Calculate] workout_seconds ÷ 60 → [Set Variable] "workout_minutes"
```

### 6. Stand hours

```text
[Find Health Samples] Sample Type: Apple Stand Hour, Start Date is today
[Count] Items  → [Set Variable] "stand_hours"
```

> If "Apple Stand Hour" isn't in the Sample Type picker on your iOS version, skip this block —
> the webhook stores `""` and the column stays blank.

### 7. exported_at + POST

```text
[Date] Current Date → [Set Variable] "exported_at"   (ISO 8601 is the default)

[Dictionary]
   date              : [date]
   steps             : [steps]
   sleep_hours       : [sleep_hours]
   hrv_ms            : [hrv_ms]
   resting_hr_bpm    : [resting_hr_bpm]
   active_calories   : [active_calories]
   stand_hours       : [stand_hours]
   workout_minutes   : [workout_minutes]
   blood_oxygen_pct  : [blood_oxygen_pct]
   noise_exposure_db : [noise_exposure_db]
   mindful_minutes   : [mindful_minutes]
   exported_at       : [exported_at]

[Get Contents of URL]
   - URL: your health webhook URL
   - Method: POST
   - Headers: Content-Type = application/json
   - Request Body: JSON → [Dictionary]
```

---

## Automate it (hands-free)

1. Shortcuts app → **Automation** tab → **+** → **Create Personal Automation**
2. Trigger: **Time of Day** → **23:55** → **Daily**
3. Action: **Run Shortcut** → *Health Sync*
4. Turn **Ask Before Running** **OFF** (and *Notify When Run* off if you want it silent)

Now it logs a complete daily Health row every night with zero interaction.

---

## Test

```bash
# Direct webhook test (no shortcut needed)
curl -X POST "YOUR_HEALTH_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-05-23","steps":8432,"sleep_hours":7.2,"hrv_ms":42.3,"resting_hr_bpm":58,"active_calories":620,"stand_hours":11,"workout_minutes":45,"blood_oxygen_pct":97.5,"noise_exposure_db":72.1,"mindful_minutes":10,"exported_at":"2026-05-23T23:55:00Z"}'
# Expected: {"status":"ok","upserted":"2026-05-23"}
```

Then run the shortcut by hand and confirm a row with today's date appears in the `Health` tab.

---

## About the generated file

`generate-health-sync.py` emits an importable `health-sync.shortcut` that asks for the webhook
URL on import (like the `Mark` core). It is a **wired scaffold**, not a finished shortcut:

- **Done for you:** Current Date → `date`, the `exported_at` stamp, the full 12-key Dictionary,
  and the POST (Get Contents of URL) — so the JSON body and the URL prompt are already correct.
- **You fill in:** the 11 Health reads appear as inline `>> ADD (<metric>): …` Comment actions,
  each followed by an empty Set Variable so the Dictionary stays wired. Replace each comment with
  the real Health action from the **Build steps** above, then delete the empty init beside it.

Why a scaffold and not the real reads: the *Find Health Samples*, *Calculate Statistics*,
*Repeat*, and *Find Workouts* action identifiers shift across iOS versions and aren't safe to
emit blind — generating them risks a file that won't import. The scaffold always imports and
saves you the plumbing; this guide is the source of truth for the reads (same relationship
`generate-log-event.py` has to the hand-built `Mark`).
