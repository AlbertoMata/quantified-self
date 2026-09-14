// The retry decorator. Written after a real 503 killed a nightly TaskDaily run
// on 2026-09-14 — the one pipeline whose missed day cannot be backfilled.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Clock } from "../ports/clock.ts";
import type { HttpResponse, HttpTransport } from "../ports/http.ts";
import type { Logger } from "../ports/logger.ts";
import {
	DEFAULT_RETRY_POLICY,
	isTransientStatus,
	retryDelayMs,
	withRetry,
	type RetryPolicy,
} from "./retry-transport.ts";

const FAST: RetryPolicy = {
	maxAttempts: 3,
	baseDelayMs: 10,
	maxDelayMs: 40,
};

// A clock that RECORDS sleeps instead of taking them. A fake that actually
// slept would add real seconds to the suite for no signal.
function recordingClock(): Clock & { slept: number[] } {
	const slept: number[] = [];
	return {
		slept,
		now: () => new Date("2026-09-14T07:00:00Z"),
		sleep: (ms: number) => {
			slept.push(ms);
		},
	};
}

function collectingLogger(): Logger & { lines: string[] } {
	const lines: string[] = [];
	return { lines, log: (line: string) => lines.push(line) };
}

// A transport that replays a scripted list of outcomes, one per call.
function scriptedTransport(
	outcomes: readonly (HttpResponse | Error)[],
): HttpTransport & { calls: number } {
	let calls = 0;
	const issue = (): HttpResponse => {
		const outcome =
			outcomes[calls] ?? outcomes[outcomes.length - 1];
		calls += 1;
		if (outcome instanceof Error) throw outcome;
		return outcome as HttpResponse;
	};
	return {
		get calls() {
			return calls;
		},
		get: issue,
		post: issue,
	};
}

function ok(body = "{}"): HttpResponse {
	return { status: 200, body };
}

// ── the policy ───────────────────────────────────────────────────────────────

test("only failures that plausibly clear on their own are transient", () => {
	// The 503 this was written for.
	assert.equal(isTransientStatus(503), true);
	assert.equal(isTransientStatus(500), true);
	assert.equal(isTransientStatus(502), true);
	assert.equal(isTransientStatus(429), true);
	assert.equal(isTransientStatus(408), true);
});

test("a client error is NOT retried", () => {
	// A 401 is a bad token and a 400 is a bad request. Both are still wrong
	// three seconds later, and retrying spends the 6-minute budget to arrive
	// at the same error with a worse log.
	assert.equal(isTransientStatus(401), false);
	assert.equal(isTransientStatus(403), false);
	assert.equal(isTransientStatus(400), false);
	assert.equal(isTransientStatus(404), false);
	assert.equal(isTransientStatus(200), false);
});

test("the backoff doubles and is capped", () => {
	assert.equal(retryDelayMs(1, DEFAULT_RETRY_POLICY), 1_000);
	assert.equal(retryDelayMs(2, DEFAULT_RETRY_POLICY), 2_000);
	assert.equal(retryDelayMs(3, DEFAULT_RETRY_POLICY), 4_000);
	// The cap is what keeps the 6-minute execution budget predictable.
	assert.equal(retryDelayMs(10, DEFAULT_RETRY_POLICY), 8_000);
});

test("the default policy stays inside a sane share of the budget", () => {
	// Three attempts, 1s + 2s of waiting. A paged endpoint multiplies this by
	// the page count, so raising it is not free — this asserts the intent.
	const total =
		retryDelayMs(1, DEFAULT_RETRY_POLICY) +
		retryDelayMs(2, DEFAULT_RETRY_POLICY);
	assert.equal(DEFAULT_RETRY_POLICY.maxAttempts, 3);
	assert.equal(total, 3_000);
});

// ── retrying ─────────────────────────────────────────────────────────────────

test("a 503 that clears on the second try succeeds", () => {
	// The exact failure: `Todoist /projects → HTTP 503` at 01:06, upstream, and
	// gone moments later.
	const clock = recordingClock();
	const transport = scriptedTransport([
		{ status: 503, body: "" },
		ok('{"results":[]}'),
	]);

	const response = withRetry(transport, {
		clock,
		logger: collectingLogger(),
		policy: FAST,
	}).get("https://api.todoist.com/api/v1/projects", {});

	assert.equal(response.status, 200);
	assert.equal(transport.calls, 2);
	assert.deepEqual(clock.slept, [10]);
});

test("a success on the first try sleeps not at all", () => {
	const clock = recordingClock();
	const transport = scriptedTransport([ok()]);

	withRetry(transport, {
		clock,
		logger: collectingLogger(),
		policy: FAST,
	}).get("https://api.todoist.com/api/v1/projects", {});

	assert.equal(transport.calls, 1);
	assert.deepEqual(clock.slept, []);
});

test("a 401 is returned immediately, unretried", () => {
	const clock = recordingClock();
	const transport = scriptedTransport([
		{ status: 401, body: "bad token" },
	]);

	const response = withRetry(transport, {
		clock,
		logger: collectingLogger(),
		policy: FAST,
	}).get("https://api.todoist.com/api/v1/projects", {});

	assert.equal(response.status, 401);
	assert.equal(transport.calls, 1, "a bad token is not a blip");
	assert.deepEqual(clock.slept, []);
});

test("a persistent 503 is RETURNED, not thrown, once attempts run out", () => {
	// The caller owns the "a failed page is fatal" decision —
	// fetchAllTodoistPages turns this into the legible error. A decorator that
	// threw here would move that decision somewhere nobody looks.
	const clock = recordingClock();
	const transport = scriptedTransport([{ status: 503, body: "down" }]);

	const response = withRetry(transport, {
		clock,
		logger: collectingLogger(),
		policy: FAST,
	}).get("https://api.todoist.com/api/v1/projects", {});

	assert.equal(response.status, 503);
	assert.equal(response.body, "down");
	assert.equal(transport.calls, 3, "exactly maxAttempts, no more");
	assert.deepEqual(clock.slept, [10, 20]);
});

test("no extra request is made after the last attempt", () => {
	// The bug this catches: a fallthrough that re-issues the request to produce
	// a return value would make maxAttempts+1 calls and double the last delay.
	const transport = scriptedTransport([{ status: 500, body: "" }]);
	withRetry(transport, {
		clock: recordingClock(),
		logger: collectingLogger(),
		policy: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1 },
	}).get("https://api.todoist.com/api/v1/tasks", {});
	assert.equal(transport.calls, 2);
});

// ── thrown failures ──────────────────────────────────────────────────────────

test("a dropped connection is retried like a 503", () => {
	// Per the HttpTransport contract a throw means the request could not be
	// made at all — a DNS failure or a dropped connection, as transient as a
	// 5xx and just as worth waiting out.
	const clock = recordingClock();
	const transport = scriptedTransport([
		new Error("Address unavailable"),
		ok(),
	]);

	const response = withRetry(transport, {
		clock,
		logger: collectingLogger(),
		policy: FAST,
	}).get("https://api.todoist.com/api/v1/projects", {});

	assert.equal(response.status, 200);
	assert.equal(transport.calls, 2);
});

test("a persistent connection failure re-throws the ORIGINAL error", () => {
	// Its text is the only diagnostic there is; wrapping it in "retries
	// exhausted" would hide the one useful sentence.
	const transport = scriptedTransport([new Error("Address unavailable")]);

	assert.throws(
		() =>
			withRetry(transport, {
				clock: recordingClock(),
				logger: collectingLogger(),
				policy: FAST,
			}).get("https://api.todoist.com/api/v1/projects", {}),
		/Address unavailable/,
	);
	assert.equal(transport.calls, 3);
});

test("a throw followed by a transient status reports the STATUS", () => {
	// The outcome reported must be the last thing that happened, not the first.
	const transport = scriptedTransport([
		new Error("Address unavailable"),
		{ status: 503, body: "down" },
		{ status: 503, body: "down" },
	]);

	const response = withRetry(transport, {
		clock: recordingClock(),
		logger: collectingLogger(),
		policy: FAST,
	}).get("https://api.todoist.com/api/v1/projects", {});

	assert.equal(response.status, 503);
});

// ── POST ─────────────────────────────────────────────────────────────────────

test("a POST is retried too — the /sync uuid makes replay a no-op", () => {
	// Retrying a POST is not generally safe. It is safe HERE because the only
	// POST in the project is Todoist's /sync, and every command carries an
	// idempotency uuid: replaying one does nothing rather than rescheduling a
	// task twice.
	const transport = scriptedTransport([{ status: 502, body: "" }, ok()]);

	const response = withRetry(transport, {
		clock: recordingClock(),
		logger: collectingLogger(),
		policy: FAST,
	}).post("https://api.todoist.com/api/v1/sync", {}, "{}");

	assert.equal(response.status, 200);
	assert.equal(transport.calls, 2);
});

// ── the log ──────────────────────────────────────────────────────────────────

test("every retry says what happened and what it is doing about it", () => {
	// A silent retry is worse than none: a run that took four minutes for no
	// visible reason is untraceable in the executions dashboard.
	const logger = collectingLogger();
	withRetry(scriptedTransport([{ status: 503, body: "" }]), {
		clock: recordingClock(),
		logger,
		policy: FAST,
	}).get("https://api.todoist.com/api/v1/projects?cursor=abc", {});

	assert.equal(
		logger.lines.length,
		3,
		"two retries and a giving-up line",
	);
	assert.match(logger.lines[0] ?? "", /GET \/api\/v1\/projects/);
	assert.match(logger.lines[0] ?? "", /HTTP 503/);
	assert.match(logger.lines[0] ?? "", /attempt 2 of 3/);
	assert.match(logger.lines[2] ?? "", /giving up after 3 attempt/);
});

test("the log names the path, not the whole cursor-bearing URL", () => {
	// A line that may repeat three times should stay readable.
	const logger = collectingLogger();
	withRetry(scriptedTransport([{ status: 500, body: "" }]), {
		clock: recordingClock(),
		logger,
		policy: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1 },
	}).get(
		"https://api.todoist.com/api/v1/tasks/filter?query=overdue&limit=50",
		{},
	);
	assert.match(logger.lines[0] ?? "", /GET \/api\/v1\/tasks\/filter:/);
	assert.doesNotMatch(logger.lines[0] ?? "", /query=overdue/);
});
