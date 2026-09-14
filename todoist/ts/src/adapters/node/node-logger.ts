// Logger over stdout.
//
// Under Actions this is what lands in the workflow log, which is the closest
// thing the runner has to the executions dashboard. Same rule as the GAS
// adapter: no error() — failures travel as thrown exceptions, because a
// non-zero exit is what makes a workflow go red, and a logged "error" line does
// nothing at all.

import type { Logger } from "../../ports/logger.ts";

export function createNodeLogger(): Logger {
	return {
		log(message: string): void {
			console.log(message);
		},
	};
}
