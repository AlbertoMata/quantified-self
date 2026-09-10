# Tab: `KarmaStats`

One row per day capturing Todoist's own productivity metrics.

| | |
| --- | --- |
| **Sheet · tab** | `quantified-self-todoist` · `KarmaStats` |
| **Written by** | `syncKarmaStats()` in [`../todoist-sync.gs`](../todoist-sync.gs), from `/tasks/completed/stats` ∥ `/user/stats` (first one that answers) |
| **Strategy** | Upsert in place — if the row already exists for today, update it |
| **Dedup key** | `date` |

---

## What it is

Todoist's karma score and daily counters, captured once per day. Unlike the other tabs
nothing here is derived from tasks — these are the numbers Todoist itself reports.

The one-row-per-day shape and the plain `date` key make this the easiest Todoist tab to
blend against the `Health` sheet.

---

## Columns

| # | Column | Type | Example | Notes |
|---|---|---|---|---|
| A | `date` | YYYY-MM-DD | `2026-05-23` | Stats date — dedup key |
| B | `karma_score` | integer | `15420` | Total karma at time of sync |
| C | `karma_delta` | integer | `42` | Change from the previous day's score |
| D | `tasks_completed` | integer | `8` | Total completions for the day |
| E | `tasks_added` | integer | `3` | Tasks created that day |
| F | `streak_days` | integer | `14` | Current daily completion streak |
| G | `sync_date` | YYYY-MM-DD | `2026-05-23` | When the sync ran |

**Header row:**
```
date	karma_score	karma_delta	tasks_completed	tasks_added	streak_days	sync_date
```

> **Historical caveat**: rows written before 2026-08-20 are keyed one day ahead (UTC date
> stamp at a 23:30 local trigger); shift them back a day when joining with the `Health`
> sheet — see [history.md](../history.md#2026-08-20--utc--local-date-stamps).

---

## See also

- [history.md](../history.md) — the 2026-08-20 date-stamp fix, which matters here because
  `date` is the join key
- [`../../../todoist/looker/todoist-blends.md`](../looker/todoist-blends.md) — the
  productivity-vs-sleep/HRV blend
