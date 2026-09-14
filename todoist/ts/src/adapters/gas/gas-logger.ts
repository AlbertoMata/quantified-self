// ─────────────────────────────────────────────────────────────────────────────
// Logger over Apps Script's Logger
//
// This is the observability story. There is no error() by design: a thrown
// exception is what reaches the executions dashboard, and a logged "error"
// string is something nobody is watching. The orchestrator collects step
// failures and rethrows at the end for exactly that reason.
// ─────────────────────────────────────────────────────────────────────────────

import type { Logger } from "../../ports/logger.ts";
import type { GasLogger } from "./gas-types.ts";

export function createGasLogger(gasLogger: GasLogger): Logger {
	return {
		log(message: string): void {
			gasLogger.log(message);
		},
	};
}
