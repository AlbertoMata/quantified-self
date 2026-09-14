// Clock over the Node runtime.
//
// Fully implemented, because there is nothing platform-specific about asking
// what time it is. The interesting half is sleep().

import type { Clock } from "../../ports/clock.ts";

export function createNodeClock(): Clock {
	return {
		now(): Date {
			return new Date();
		},

		// A genuinely SYNCHRONOUS sleep, which Node does not otherwise offer.
		//
		// This matters more than it looks. The whole seam is synchronous
		// because an Apps Script trigger cannot await — so the Node adapter is
		// the side that has to pay for that, and `await setTimeout()` is not
		// available to it. Atomics.wait blocks the calling thread outright,
		// which is exactly the semantics Utilities.sleep has.
		//
		// Blocking a thread is usually a mistake. Here it is the contract: the
		// only callers are the paginator's 300ms courtesy delay and the
		// completions windower's 400ms, both of which exist precisely to stop
		// work happening for a moment.
		sleep(milliseconds: number): void {
			if (milliseconds <= 0) return;
			const buffer = new Int32Array(new SharedArrayBuffer(4));
			Atomics.wait(buffer, 0, 0, milliseconds);
		},
	};
}
