# Sheet Schema — Health

Google Sheet name: `quantified-self-health`  
Tab name: `Health`

Written automatically by the **Health Auto Export** app (iOS). The app overwrites rows for the same date, so there are no duplicates and no deduplication logic is needed in Apps Script.

---

## Columns

| # | Column | Type | Example | Notes |
|---|---|---|---|---|
| A | `date` | YYYY-MM-DD | `2026-05-23` | Join key across all sheets. Set by Health Auto Export. |
| B | `steps` | integer | `8432` | Daily step count |
| C | `sleep_hours` | decimal | `7.2` | Total sleep (all stages) in hours |
| D | `sleep_deep_hours` | decimal | `1.4` | Deep sleep hours |
| E | `sleep_rem_hours` | decimal | `1.8` | REM sleep hours |
| F | `hrv_ms` | decimal | `42.3` | HRV in ms (SDNN or RMSSD depending on source) |
| G | `resting_hr_bpm` | decimal | `58.0` | Resting heart rate |
| H | `active_calories` | integer | `620` | Active energy burned (kcal) |
| I | `stand_hours` | integer | `11` | Apple Watch stand hours (max 12) |
| J | `workout_minutes` | integer | `45` | Total workout duration for the day |
| K | `blood_oxygen_pct` | decimal | `97.5` | SpO2 average |
| L | `noise_exposure_db` | decimal | `72.1` | Average environmental noise (dB) |
| M | `mindful_minutes` | integer | `10` | Mindfulness session minutes |
| N | `exported_at` | ISO 8601 | `2026-05-23T06:00:00Z` | Timestamp of the Health Auto Export run |

---

## Header row

Paste this as row 1 in your `Health` tab:

```
date	steps	sleep_hours	sleep_deep_hours	sleep_rem_hours	hrv_ms	resting_hr_bpm	active_calories	stand_hours	workout_minutes	blood_oxygen_pct	noise_exposure_db	mindful_minutes	exported_at
```

---

## Health Auto Export setup

1. Install [Health Auto Export](https://apps.apple.com/app/health-auto-export-json-csv/id1115567069) on iPhone
2. Go to **Automations** → **Add Automation**
3. Destination: **Google Sheets**
4. Sheet: `quantified-self-health`, Tab: `Health`
5. Metrics: select all columns listed above
6. Export format: **Combined** (one row per day, wide format)
7. Frequency: **Daily** at 06:00
8. Authorize Google account access

> The app writes column headers on first run. Confirm they match the names above; rename if needed (the Apps Script sync references columns by position, not name, but Looker Studio uses column names).

---

## Tips

- If you add more metrics later (e.g. VO2 max, respiratory rate), Health Auto Export appends new columns automatically — just add them to this schema doc
- Add a Looker Studio calculated field `TODATE(date, 'YYYY-MM-DD')` if date is stored as a string, to enable proper date filtering
- The `Health` tab is the recommended **left source** for Looker Studio blends, as it has the most complete daily coverage
