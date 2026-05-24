# Shortcut: Log Focus Block

Two shortcuts — one to start a focus block, one to end it and record the duration.

---

## Shortcut: Start Focus

**Siri phrase**: "Start focus"

```
1. [Get Current Date] → store as "focus_start"

2. [Set Variable in iCloud] → "focus_block_start" = focus_start
   ← persists between runs so End Focus can read it

3. [Get Contents of URL]
   - URL: <your Apps Script URL>
   - Method: POST
   - Headers: Content-Type: application/json
   - Body (JSON):
     {
       "event_type": "focus_start",
       "value": "",
       "source": "siri"
     }

4. [Speak Text] → "Focus block started"
```

---

## Shortcut: End Focus

**Siri phrase**: "End focus"

```
1. [Get Variable from iCloud] → "focus_block_start"

2. [Get Current Date]

3. [Calculate between Dates]
   - Start: focus_block_start
   - End: Current Date
   - In: minutes
   → store result as "duration"

4. [Get Contents of URL]
   - URL: <your Apps Script URL>
   - Method: POST
   - Headers: Content-Type: application/json
   - Body (JSON):
     {
       "event_type": "focus_end",
       "value": [duration],
       "source": "siri"
     }

5. [Speak Text] → "Focus block ended. [duration] minutes."
```

---

## Notes

- iCloud variable storage persists the start time across Shortcut runs — required because iOS doesn't share state between separate shortcut invocations
- Duration is stored in minutes as a plain number (matches the `focus_end` schema)
- If you forget to end a block, the next "End Focus" run will calculate from the last "Start Focus" — just delete the stale row from the sheet
