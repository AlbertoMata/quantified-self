# Sheet Schema — Health

Google Sheet name: `quantified-self-health`  
Tab name: `Health`

Written by a free, native **Apple Shortcut** ("Health Sync") that reads Apple Health with the
built-in *Find Health Samples* + *Calculate Statistics* actions and POSTs a row to an Apps
Script webhook (`health-webhook.gs` (deleted — see [README.md](README.md))). No third-party app, no subscription.

The webhook **upserts by `date`** — re-running the shortcut for the same day overwrites that
row instead of duplicating it, so no deduplication logic is needed downstream.

> Build/setup of the shortcut itself: [../shortcuts/health-sync.md](../event-log/shortcuts/health-sync.md).

---

## Columns

| # | Column | Type | Example | Notes |
|---|---|---|---|---|
| A | `date` | YYYY-MM-DD | `2026-05-23` | Join key across all sheets. Set by the shortcut. |
| B | `steps` | integer | `8432` | Daily step count (Sum) |
| C | `sleep_hours` | decimal | `7.2` | Total time asleep last night, in hours |
| D | `hrv_ms` | decimal | `42.3` | HRV in ms (Average) |
| E | `resting_hr_bpm` | decimal | `58.0` | Resting heart rate (Average) |
| F | `active_calories` | integer | `620` | Active energy burned, kcal (Sum) |
| G | `stand_hours` | integer | `11` | Apple Watch stand hours (max 12) |
| H | `workout_minutes` | integer | `45` | Total workout duration for the day |
| I | `blood_oxygen_pct` | decimal | `97.5` | SpO2 average |
| J | `noise_exposure_db` | decimal | `72.1` | Average environmental noise (dB) |
| K | `mindful_minutes` | integer | `10` | Mindfulness session minutes |
| L | `exported_at` | ISO 8601 | `2026-05-23T23:55:00Z` | When the Health Sync shortcut ran |

> **Sleep granularity**: this schema tracks total `sleep_hours` only. Stage breakdown
> (deep/REM/core) is intentionally omitted — summing per-sample stage durations makes the
> shortcut much longer and more fragile. Add it later if the correlation analysis needs it.

---

## Header row

Paste this as row 1 in your `Health` tab:

```
date	steps	sleep_hours	hrv_ms	resting_hr_bpm	active_calories	stand_hours	workout_minutes	blood_oxygen_pct	noise_exposure_db	mindful_minutes	exported_at
```

---

## Setup (free, native Shortcut + webhook)

1. Create `quantified-self-health` → tab named `Health` → paste the header row above → freeze row 1.
2. **Extensions → Apps Script** → paste `health-webhook.gs` (deleted — see [README.md](README.md)) → Save.
3. **Deploy → New deployment** → Web app → Execute as: **Me** → Access: **Anyone** → Deploy.
   Copy the Web App URL — this is the health webhook (separate from the Log webhook).
4. Build the **Health Sync** shortcut and paste that URL into it — see
   [../shortcuts/health-sync.md](../event-log/shortcuts/health-sync.md). It runs daily at ~23:55 via a
   Time-of-Day automation with *Ask Before Running* off.

### Test the webhook

```bash
curl -X POST "YOUR_HEALTH_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-05-23","steps":8432,"sleep_hours":7.2,"hrv_ms":42.3,"resting_hr_bpm":58,"active_calories":620,"stand_hours":11,"workout_minutes":45,"blood_oxygen_pct":97.5,"noise_exposure_db":72.1,"mindful_minutes":10,"exported_at":"2026-05-23T23:55:00Z"}'

# Expected: {"status":"ok","upserted":"2026-05-23"}
```

POST the same `date` twice — the row should be overwritten, not duplicated.

---

## Caveats

- **`stand_hours`** relies on the *Apple Stand Hour* type being available in the *Find Health
  Samples* picker on your iOS version. If it isn't, leave it blank or approximate it from Stand
  Time. Each Apple Stand Hour sample = one stand hour, so the shortcut just **counts** them.
- **Reliability**: native Time-of-Day automations are dependable but occasionally want the
  phone unlocked at fire time. This is the trade-off vs the paid app's true background sync — if
  a night is missed, run the shortcut by hand (the upsert fills the gap by date).
- **Sleep date boundary**: the shortcut queries sleep over a *last-night range* (≈ yesterday
  18:00 → now), not "Today", so an overnight block whose start is yesterday is still counted.
  Running the shortcut late (≈23:55) keeps each row's activity metrics complete for that day.

---

## Tips

- Add a Looker Studio calculated field `TODATE(date, 'YYYY-MM-DD')` if `date` is stored as a
  string, to enable proper date filtering.
- The `Health` tab is the recommended **left source** for Looker Studio blends — it has the most
  complete daily coverage.
- Adding a metric later = add a column here, add the matching key to the shortcut's Dictionary,
  and add the name to `COLS` in `health-webhook.gs` (deleted — see [README.md](README.md)).
