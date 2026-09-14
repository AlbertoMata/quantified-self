// ─────────────────────────────────────────────────────────────────────────────
// HttpTransport over Node — NOT YET IMPLEMENTED, and the hardest thing in
// Phase F. Worth stating the problem now rather than discovering it there.
//
// THE PROBLEM: the port contract is SYNCHRONOUS. That was almost free on the
// Apps Script side — UrlFetchApp is synchronous already — and it exists because
// a trigger cannot await: a rejected promise never reaches the executions
// dashboard, so a failed nightly run would report success. The bill for that
// decision lands here. Node's fetch is async, and there is no synchronous HTTP
// client in the standard library.
//
// Three ways out, in the order I would try them:
//
//   1. `execFileSync("curl", …)`. Genuinely synchronous, no dependency, and
//      trivially debuggable — you can paste the command into a shell. Costs a
//      process per request, which for a nightly run making tens of calls is
//      irrelevant. Needs care passing the token: via a header FILE or stdin,
//      never argv, where it would be visible in the process list.
//
//   2. A worker thread plus `Atomics.wait`. Keeps everything in-process and is
//      the "proper" answer, at the cost of real complexity — the worker does
//      the fetch, writes into a SharedArrayBuffer, and the main thread blocks.
//      Serialising a response through a SharedArrayBuffer is fiddly enough to
//      deserve its own tests.
//
//   3. Relax the contract to async and keep a synchronous façade only for the
//      GAS adapter. This is the option to resist: it would make every pipeline
//      above the seam async, which is precisely what the ban exists to prevent,
//      and the two runtimes would stop sharing the code that matters.
//
// My inclination is (1) until something proves it inadequate. Deciding is a
// Phase F job; recording the analysis is a Phase B one.
// ─────────────────────────────────────────────────────────────────────────────

import type { HttpTransport } from "../../ports/http.ts";
import { notImplemented } from "./not-implemented.ts";

export function createNodeHttpTransport(): HttpTransport {
	return {
		get() {
			return notImplemented("HttpTransport.get", "F2");
		},
		post() {
			return notImplemented("HttpTransport.post", "F2");
		},
	};
}
