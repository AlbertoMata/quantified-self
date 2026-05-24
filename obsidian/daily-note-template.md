---
date: <% tp.date.now("YYYY-MM-DD") %>
week: <% tp.date.now("W") %>
tags: [daily]
---

# <% tp.date.now("dddd, MMMM D") %>

## Yesterday's metrics

<%*
// Read the summary file written by the Morning Summary Shortcut.
// The Shortcut writes to _qs-summary.md in the vault root each morning.
const summaryFile = tp.file.find_tfile("_qs-summary");
if (summaryFile) {
  tR += await tp.file.include("[[_qs-summary]]");
} else {
  tR += "> _No summary yet — run the Morning Summary Shortcut first._\n";
}
%>

---

## Today

### Top 3

- [ ] 
- [ ] 
- [ ] 

### Notes

(free text)

### Mood check-in

> Say "Hey Siri, Log mood" at any point during the day.

---

## Evening reflection

**What went well?**

**What would I do differently?**

**One thing I'm grateful for:**
