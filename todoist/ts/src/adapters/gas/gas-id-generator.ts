// ─────────────────────────────────────────────────────────────────────────────
// IdGenerator over Utilities.getUuid
//
// Todoist's /sync uses a client-supplied uuid per command as its IDEMPOTENCY
// key: replaying a command with the same uuid is a no-op rather than a second
// write. This is the only write path to Todoist in the whole system, so this
// value is what stands between a retried run and a double reschedule.
//
// A fresh uuid per command, therefore — and never a reused or derived one.
// ─────────────────────────────────────────────────────────────────────────────

import type { IdGenerator } from "../../ports/id-generator.ts";
import type { GasUtilities } from "./gas-types.ts";

export function createGasIdGenerator(utilities: GasUtilities): IdGenerator {
	return {
		newUuid(): string {
			return utilities.getUuid();
		},
	};
}
