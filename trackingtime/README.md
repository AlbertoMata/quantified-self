# TrackingTime → Sheets

**Status: not built.** No code, no sheet, no schema yet. This directory marks the slot and
holds the decisions until they get made.

TrackingTime replaces **Everhour**, which has been removed from this repo entirely — code and
schema both. The `quantified-self-everhour` spreadsheet still exists and still holds real
history; nothing in it is documented here any more. To read those columns again, recover the
schema from git:

```sh
git show ae21f1f:sheets/schema-everhour.md      # column meanings, dedup key, rate conversion
git show ae21f1f:sheets/everhour-sync.gs        # the nightly pull, if it is ever wanted back
```

## ⚠️ The live Everhour Apps Script project is still running

Deleting the repo copy did **not** touch Google. The standalone project *Quantified Self -
Everhour Sync* still exists with its nightly `syncEverhour` trigger, and will keep firing —
failing against an account you no longer use, or quietly writing empty days.

**Disable that trigger** in the Apps Script editor (Triggers → delete `syncEverhour`), or delete
the project outright. Nothing in this repo can do it for you, and it is the one loose end this
cleanup could not tie off.

## What this integration will need

The same shape every other source here has, with [`../todoist/`](../todoist/README.md) as the
reference implementation:

- A Google Sheet (`quantified-self-trackingtime`, presumably) with a tab per data shape
- A `schema.md` per tab — column meanings, dedup key, write strategy
- A sync that pulls on a schedule and upserts on a stable ID

## Open questions, when the time comes

| Question | Why it matters |
| --- | --- |
| **Does it build in `todoist/ts/` or as another `.gs` file?** | If the [TypeScript port](../docs/plans/typescript-port.md) has reached Phase D by then, this should be the first integration written *natively* in the new layers rather than ported into them — no parity bar to clear makes it the easiest possible proving ground. It would also be the first non-Todoist thing in a workspace that currently lives under `todoist/` |
| **Is there a stable join key to Todoist?** | Everhour had one: task IDs prefixed `td:`, which made "hours per completed task" a plain join. Whether TrackingTime exposes an equivalent decides whether time and tasks can be correlated at all |
| **Does the Everhour history migrate?** | Copying the old tab into a TrackingTime-shaped one makes a single continuous series; leaving it separate means every time-based chart has a seam at the switchover date |
| **What is the API's pagination and rate limit?** | The two things that shaped the old Everhour client, and the two most likely to differ |

Nothing above is decided. Do not infer an API shape from this file — none of it has been checked
against TrackingTime's documentation.
