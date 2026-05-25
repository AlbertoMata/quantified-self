# Shortcut: Log Mood

**Siri phrase**: "Log mood"

Records a mood rating (1–5) with a timestamp.

---

## Steps

```
1. [List]
   - Items: 1, 2, 3, 4, 5

2. [Choose from List]
   - Prompt: "How's your mood?"
   → result flows automatically to the next step

3. [Set Variable] → "mood_value"

4. [Get Contents of URL]
   - URL: <your Apps Script URL>
   - Method: POST
   - Headers: Content-Type: application/json
   - Body (JSON):
     {
       "event_type": "mood",
       "value": [mood_value],
       "source": "siri"
     }

5. [Speak Text] → "Mood logged"   ← confirms via AirPods
```

---

## Notes

- "Choose from List" returns the selected item as output — "Set Variable" in step 3 captures it implicitly (no need to reference "Chosen Item" manually)
- Works via Siri on AirPods or as a Watch complication tap
- `source` will be `"siri"` when triggered by voice, adjust to `"watch"` if you make a separate Watch-only version
