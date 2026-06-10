# Sheet Schema

Google Sheet name: `quantified-self-log`  
Tab name: `Log`

---

## Columns

| # | Column | Type | Example | Notes |
|---|---|---|---|---|
| A | `timestamp` | ISO 8601 string | `2026-05-23T08:32:00Z` | Always UTC. Auto-set by Apps Script if omitted. |
| B | `event_type` | string | `mood` | See event types below |
| C | `value` | string | `4` | Numeric or categorical depending on event |
| D | `notes` | string | `slept badly` | Optional free text |
| E | `source` | string | `iPhone` | Device model returned by the Shortcuts **Device Details** action (e.g. `iPhone`, `Apple Watch Series 9`). Set automatically — no manual input needed. |

---

## Event types

| `event_type` | `value` format | Example value |
|---|---|---|
| `mood` | Integer 1–5 | `4` |
| `food` | Integer 1–5 or label | `3` or `healthy` |
| `caffeine` | Count or `yes`/`no` | `2` |
| `focus_start` | Empty | `` |
| `focus_end` | Duration in minutes | `52` |
| `wake_up` | Empty (timestamp carries it) | `` |
| `arrived_home` | Empty | `` |
| `left_home` | Empty | `` |
| `commute_start` | Empty | `` |
| `nof` | Empty (timestamp carries it) | `` |
| `chairmaxxing` | Empty (timestamp carries it) | `` |
| `custom` | Free text | `had a difficult conversation` |

---

## Header row

Paste this as row 1 in your `Log` tab:

```
timestamp	event_type	value	notes	source
```

---

## Tips

- Keep `value` as a string in the sheet — you can cast to number in Looker Studio
- Don't rename columns; the Apps Script references them by position (appendRow)
- Add a second tab called `Health` for Apple Health exports (phase 1.5)
- Freeze row 1 (View → Freeze → 1 row) so headers stay visible
