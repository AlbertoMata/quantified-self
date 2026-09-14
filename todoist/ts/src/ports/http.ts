// ─────────────────────────────────────────────────────────────────────────────
// HttpTransport — the only way anything above ports/ reaches the network
//
// SYNCHRONOUS BY CONTRACT, and this is the single most consequential decision in
// the whole seam. An Apps Script trigger cannot await: the entry point returns
// before a promise settles, so a REJECTED promise never reaches the executions
// dashboard and a failed nightly run reports success. UrlFetchApp is already
// synchronous; the Node adapter is what pays the cost, by resolving before it
// returns. That keeps every pipeline above this line free of async entirely.
// ─────────────────────────────────────────────────────────────────────────────

// A response, always returned — never thrown.
//
// The legacy code passes muteHttpExceptions: true and inspects the status
// itself, because Todoist answers a rate-limit with 429 and a body worth
// reading, and a transport that throws on non-2xx destroys that body before
// anyone can look at it. Keep that: HTTP status is data, not an exception.
// A transport throws only when the request could not be made at all.
export interface HttpResponse {
	readonly status: number;
	readonly body: string;
}

export interface HttpTransport {
	get(
		url: string,
		headers: Readonly<Record<string, string>>,
	): HttpResponse;

	post(
		url: string,
		headers: Readonly<Record<string, string>>,
		body: string,
	): HttpResponse;
}
