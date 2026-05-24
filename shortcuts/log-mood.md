# Shortcut: Log Mood

**Siri phrase**: "Log mood"

Records a mood rating (1–5) with a timestamp.

---

## Steps

```
1. [Choose from Menu]
   - Title: "How's your mood?"
   - Options: 1 · 2 · 3 · 4 · 5

2. [Set Variable] → "mood_value" = Chosen Menu Item

3. [Get Contents of URL]
   - URL: <your Apps Script URL>
   - Method: POST
   - Headers: Content-Type: application/json
   - Body (JSON):
     {
       "event_type": "mood",
       "value": [mood_value],
       "source": "siri"
     }

4. [Speak Text] → "Mood logged"   ← confirms via AirPods
```

---

## Notes

- Works via Siri on AirPods or as a Watch complication tap
- The menu selection keeps it hands-free; no typing required
- `source` will be `"siri"` when triggered by voice, adjust to `"watch"` if you make a separate Watch-only version
