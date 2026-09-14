// ─────────────────────────────────────────────────────────────────────────────
// Retrying transient HTTP failures — a decorator over HttpTransport
//
// WHY THIS EXISTS: on 2026-09-14 at 01:06 a nightly TaskDaily run died on
// `Todoist /projects → HTTP 503`. Todoist was briefly down; the port did exactly
// what the legacy does, which is throw and lose the run. That is survivable for
// most tabs — they recompute from live state on the next run — and NOT
// survivable for TaskDaily, which is observed-only: Todoist keeps no record of
// what was open on a past date, so a run lost to a thirty-second blip is a
// permanent hole no re-run can fill.
//
// This is deliberately NOT a parity break. A run that succeeds produces byte-
// identical rows either way; the only difference is how many runs succeed. The
// legacy has no retry, so during Phase E the port will occasionally survive a
// blip the legacy does not — a divergence that shows up in the E3 diff as the
// port having a row for a day the legacy missed. Expect it, and read it as the
// port being right.
//
// WHAT IS AND IS NOT RETRIED. Only failures that plausibly clear on their own:
// 429, 408, and 5xx. A 401 is a bad token and a 400 is a bad request — both are
// still wrong three seconds later, and retrying them spends the 6-minute
// execution budget to arrive at the same error with a worse log.
//
// RETRYING A POST IS SAFE HERE, which is not generally true. The only POST in
// the project is Todoist's /sync, and every command it carries has an
// idempotency uuid: replaying one is a no-op rather than a second write. That is
// the property reschedule-habits.ts already depends on, and it is what makes
// this decorator safe to apply to the whole transport rather than to reads only.
// ─────────────────────────────────────────────────────────────────────────────

import type { Clock } from "../ports/clock.ts";
import type { HttpResponse, HttpTransport } from "../ports/http.ts";
import type { Logger } from "../ports/logger.ts";

export interface RetryPolicy {
	// Total tries, not retries. 3 means one attempt and two more.
	readonly maxAttempts: number;
	readonly baseDelayMs: number;
	readonly maxDelayMs: number;
}

// Three attempts, backing off 1s then 2s.
//
// The budget, not a guess: every sleep here is charged against the same
// 6-minute cap as the work, and a paged endpoint multiplies it by the page
// count. Three attempts covers the blip this was written for — a few seconds of
// upstream unavailability — while adding at most 3s to a request that is going
// to fail anyway. An outage lasting longer than that is not a retry problem; it
// is a missed run, and the executions dashboard should say so.
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
	maxAttempts: 3,
	baseDelayMs: 1_000,
	maxDelayMs: 8_000,
};

// Will this status plausibly be different in a second?
//
// 429 is included even though the rate limit is per token and shared with the
// legacy sync for the whole of Phase E — which is exactly why it is worth
// waiting out: the two implementations overlapping is the most likely cause,
// and it resolves on its own.
export function isTransientStatus(status: number): boolean {
	return status === 408 || status === 429 || status >= 500;
}

// Exponential backoff, capped. `attempt` is 1-based: the delay AFTER attempt 1.
//
// No jitter, deliberately. Jitter exists to stop a thundering herd of clients
// synchronising; there is exactly one client here, and an unpredictable delay
// would make the 6-minute budget unpredictable too.
export function retryDelayMs(attempt: number, policy: RetryPolicy): number {
	const delay = policy.baseDelayMs * Math.pow(2, attempt - 1);
	return Math.min(delay, policy.maxDelayMs);
}

export interface RetryContext {
	readonly clock: Clock;
	readonly logger: Logger;
	readonly policy?: RetryPolicy;
}

// Wrap a transport so transient failures are retried before they become errors.
//
// The wrapped transport keeps the port's contract exactly: status is still data
// and is still returned, including a transient one once the attempts run out.
// Callers do not learn that retrying happened except through the log — which
// matters, because fetchAllTodoistPages decides what a failed page means and
// that decision should stay in one place.
export function withRetry(
	transport: HttpTransport,
	context: RetryContext,
): HttpTransport {
	const policy = context.policy ?? DEFAULT_RETRY_POLICY;

	function attempt(
		label: string,
		issue: () => HttpResponse,
	): HttpResponse {
		let lastError: unknown = null;
		let lastResponse: HttpResponse | null = null;

		for (let tries = 1; tries <= policy.maxAttempts; tries += 1) {
			let response: HttpResponse | null = null;
			try {
				response = issue();
				if (!isTransientStatus(response.status)) {
					return response;
				}
				// A transient status: remember it, and clear any earlier
				// throw so the outcome reported is the LAST thing that
				// happened, not the first.
				lastResponse = response;
				lastError = null;
			} catch (error) {
				lastResponse = null;
				// A THROW from the transport means the request could not be
				// made at all — a DNS failure or a dropped connection, per the
				// HttpTransport contract. That is as transient as a 503 and is
				// retried the same way. It is also why this decorator is only
				// applied to the live Apps Script transport: wrapping the Node
				// stub would retry its notImplemented three times over.
				lastError = error;
			}

			if (tries === policy.maxAttempts) break;

			const delay = retryDelayMs(tries, policy);
			context.logger.log(
				`${label}: ${describeAttempt(response, lastError)} ` +
					`— retrying in ${delay}ms (attempt ${tries + 1} of ${policy.maxAttempts})`,
			);
			context.clock.sleep(delay);
		}

		// Out of attempts. A status comes back as data for the caller to
		// describe — fetchAllTodoistPages owns the "a failed page is fatal"
		// decision and should keep owning it. A throw is re-thrown with its
		// original message intact, because a connection error's text is the
		// only diagnostic there is.
		context.logger.log(
			`${label}: giving up after ${policy.maxAttempts} attempt(s)`,
		);
		if (lastResponse) return lastResponse;
		throw lastError;
	}

	function describeAttempt(
		response: HttpResponse | null,
		error: unknown,
	): string {
		if (response) return `HTTP ${response.status}`;
		return error instanceof Error
			? `request failed (${error.message})`
			: "request failed";
	}

	return {
		get(url, headers): HttpResponse {
			return attempt(`GET ${pathOf(url)}`, () =>
				transport.get(url, headers),
			);
		},
		post(url, headers, body): HttpResponse {
			return attempt(`POST ${pathOf(url)}`, () =>
				transport.post(url, headers, body),
			);
		},
	};
}

// The path alone, for the log. A full Todoist URL carries a cursor and a filter
// query, and neither belongs in a line that may repeat three times — but the
// token never appears in a URL here, so this is legibility, not redaction.
function pathOf(url: string): string {
	const withoutQuery = url.split("?")[0] ?? url;
	const afterHost = withoutQuery.split("://")[1] ?? withoutQuery;
	const slash = afterHost.indexOf("/");
	return slash === -1 ? withoutQuery : afterHost.slice(slash);
}
