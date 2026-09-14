// ─────────────────────────────────────────────────────────────────────────────
// Clock over the runtime's own time, plus Utilities.sleep
//
// now() is just `new Date()` — not a platform call at all. It lives behind the
// port anyway, because a pipeline that reads the wall clock directly cannot be
// tested against the 2026-08-20 UTC-vs-local bug and cannot be replayed for a
// backfill. The seam is worth more than the indirection costs.
//
// NOT HERE: the timezone. Session.getScriptTimeZone() is deleted in the port —
// a GitHub runner has no ambient script timezone, so the zone is explicit
// config and formatting a day is a pure function in core/dates.ts (C1).
// ─────────────────────────────────────────────────────────────────────────────

import type { Clock } from "../../ports/clock.ts";
import type { GasUtilities } from "./gas-types.ts";

export function createGasClock(utilities: GasUtilities): Clock {
	return {
		now(): Date {
			return new Date();
		},
		sleep(milliseconds: number): void {
			// Spends the 6-minute execution budget in exchange for staying
			// under Todoist's rate limit. Callers: 300ms between pages,
			// 400ms between completion windows.
			utilities.sleep(milliseconds);
		},
	};
}
