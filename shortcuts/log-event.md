# Shortcut: Log Event (generic)

**Siri phrase**: "Log event"

Generic event logger with a menu for the most common event types, plus a free-text "Custom" option.

---

## Steps

```
1. [Choose from Menu]
   - Title: "What are you logging?"
   - Options: Coffee · Food · Water · Focus start · Focus end · Custom

2. [Set Variable] → "event_type" = Chosen Menu Item

3. [If] event_type == "Custom"
   → [Ask for Input] → Text → "Describe the event" → store as "custom_value"
   [Otherwise]
   → [Set Variable] "custom_value" = ""

4. [Get Contents of URL]
   - URL: <your Apps Script URL>
   - Method: POST
   - Headers: Content-Type: application/json
   - Body (JSON):
     {
       "event_type": [event_type],
       "value": "1",
       "notes": [custom_value],
       "source": "siri"
     }

5. [Speak Text] → "Got it"
```

---

## Notes

- The `value` defaults to `"1"` for simple yes/no events (coffee, water); adjust to ask for a count if needed
- Menu options map directly to `event_type` values in the sheet schema — keep them lowercase or normalise in the Apps Script
- Add or remove menu items as your logging habits evolve
