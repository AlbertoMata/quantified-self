// D1 — requests, responses, and the pagination rules.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Clock } from "../../ports/clock.ts";
import type { HttpResponse, HttpTransport } from "../../ports/http.ts";
import type { Logger } from "../../ports/logger.ts";
import { fetchAllTodoistPages } from "./fetch-pages.ts";
import {
	buildQueryString,
	buildUrl,
	overdueTasksRequest,
	TODOIST_PAGE_LIMIT,
} from "./requests.ts";
import {
	describeHttpFailure,
	parseJsonBody,
	parsePage,
	toIdNameMap,
	toProjectTree,
} from "./responses.ts";

// ── requests ─────────────────────────────────────────────────────────────────

test("a null cursor is omitted, not sent as the string 'null'", () => {
	// Todoist would treat "null" as a cursor and return nothing — a first page
	// that comes back empty for no visible reason.
	assert.equal(
		buildQueryString({ cursor: null, limit: 50 }),
		"?limit=50",
	);
	assert.equal(
		buildQueryString({ cursor: "abc", limit: 50 }),
		"?cursor=abc&limit=50",
	);
});

test("empty and undefined params are dropped too", () => {
	assert.equal(buildQueryString({ query: "", limit: 50 }), "?limit=50");
	assert.equal(buildQueryString({}), "");
});

test("params are URL-encoded", () => {
	// `Study/Reading` cannot be addressed by name in a filter — the `/` breaks
	// the syntax — but anything that does reach a query must survive it.
	assert.equal(
		buildQueryString({ query: "overdue & p1" }),
		"?query=overdue%20%26%20p1",
	);
});

test("every request carries the page limit, which is a cap not a preference", () => {
	// The completed-tasks endpoint silently CLAMPS higher values on some
	// accounts, making pages look complete when they are not.
	const url = buildUrl(overdueTasksRequest(), null);
	assert.match(url, /\/tasks\/filter\?/);
	assert.match(url, /query=overdue/);
	assert.match(url, new RegExp(`limit=${TODOIST_PAGE_LIMIT}`));
	assert.equal(TODOIST_PAGE_LIMIT, 50);
});

// ── responses ────────────────────────────────────────────────────────────────

test("all three page shapes parse", () => {
	// v1 returns { results, next_cursor }; some endpoints { items }; a few a
	// bare array with no pagination at all.
	assert.deepEqual(parsePage('{"results":[1,2],"next_cursor":"abc"}'), {
		items: [1, 2],
		nextCursor: "abc",
	});
	assert.deepEqual(parsePage('{"items":[1]}'), {
		items: [1],
		nextCursor: null,
	});
	assert.deepEqual(parsePage("[1,2,3]"), {
		items: [1, 2, 3],
		nextCursor: null,
	});
});

test("an empty-string cursor is treated as no cursor", () => {
	assert.equal(
		parsePage('{"results":[1],"next_cursor":""}').nextCursor,
		null,
	);
});

test("a non-JSON body fails legibly rather than as 'Unexpected token'", () => {
	// Todoist answers a deprecated endpoint with HTML or plain text, and the
	// raw JSON.parse error names neither the call nor the cause.
	assert.throws(
		() => parseJsonBody("<html>Gone</html>"),
		/returned non-JSON: <html>Gone<\/html>/,
	);
});

test("a rate limit says what to actually check", () => {
	// The failure a Phase E parallel run will hit: two implementations, one
	// token, and the limit is per token.
	const message = describeHttpFailure(
		"/tasks",
		429,
		'{"error":"too many"}',
	);
	assert.match(message, /429/);
	assert.match(message, /per TOKEN/);
	assert.match(message, /legacy sync shares this one/);
});

test("an auth failure points at the token property", () => {
	assert.match(describeHttpFailure("/tasks", 401, ""), /TODOIST_TOKEN/);
});

test("project lists become an id→name map and a tree", () => {
	const projects = [
		{ id: 1, name: "Work", parent_id: 9 },
		{ id: "2", name: "Errands", parent_id: null },
	];
	assert.deepEqual(toIdNameMap(projects), {
		"1": "Work",
		"2": "Errands",
	});
	assert.deepEqual(toProjectTree(projects), {
		"1": { name: "Work", parentId: "9" },
		"2": { name: "Errands", parentId: "" },
	});
});

// ── pagination ───────────────────────────────────────────────────────────────

function contextWith(responses: HttpResponse[]) {
	const urls: string[] = [];
	const sleeps: number[] = [];
	const lines: string[] = [];
	let index = 0;

	const http: HttpTransport = {
		get(url) {
			urls.push(url);
			const response =
				responses[index] ??
				responses[responses.length - 1];
			index += 1;
			return response ?? { status: 200, body: "[]" };
		},
		post() {
			throw new Error("no POST expected");
		},
	};
	const clock: Clock = {
		now: () => new Date("2026-09-14T05:30:00Z"),
		sleep: (ms) => sleeps.push(ms),
	};
	const logger: Logger = { log: (line) => lines.push(line) };

	return {
		context: { http, clock, logger, token: "t" },
		urls,
		sleeps,
		lines,
	};
}

test("pages are followed until the cursor clears", () => {
	const { context, urls } = contextWith([
		{ status: 200, body: '{"results":[1,2],"next_cursor":"p2"}' },
		{ status: 200, body: '{"results":[3],"next_cursor":null}' },
	]);
	const items = fetchAllTodoistPages(context, overdueTasksRequest());
	assert.deepEqual(items, [1, 2, 3]);
	assert.equal(urls.length, 2);
	assert.match(urls[1] ?? "", /cursor=p2/);
});

test("an EMPTY page stops the loop even when a cursor came back", () => {
	// Some endpoints hand out a cursor indefinitely with nothing in the batch —
	// observed on /activities. A loop trusting the cursor alone runs until the
	// 6-minute cap kills it mid-write.
	const { context, urls } = contextWith([
		{ status: 200, body: '{"results":[1],"next_cursor":"p2"}' },
		{ status: 200, body: '{"results":[],"next_cursor":"p3"}' },
	]);
	const items = fetchAllTodoistPages(context, overdueTasksRequest());
	assert.deepEqual(items, [1]);
	assert.equal(urls.length, 2, "it must not ask for p3");
});

test("a courtesy delay sits between pages, but not after the last", () => {
	// The rate limit is per token, shared with the legacy sync for all of Phase E.
	const { context, sleeps } = contextWith([
		{ status: 200, body: '{"results":[1],"next_cursor":"p2"}' },
		{ status: 200, body: '{"results":[2],"next_cursor":"p3"}' },
		{ status: 200, body: '{"results":[3],"next_cursor":null}' },
	]);
	fetchAllTodoistPages(context, overdueTasksRequest());
	assert.deepEqual(sleeps, [300, 300], "two gaps between three pages");
});

test("a failed page throws rather than returning a short list", () => {
	// Returning what we have would look like a short list, not a broken call —
	// and for an append-only tab that silently loses history.
	const { context } = contextWith([
		{ status: 200, body: '{"results":[1],"next_cursor":"p2"}' },
		{ status: 500, body: "server exploded" },
	]);
	assert.throws(
		() => fetchAllTodoistPages(context, overdueTasksRequest()),
		/HTTP 500/,
	);
});

test("a cursor that never clears stops at the page budget", () => {
	// Otherwise a nightly run hangs until Apps Script kills it.
	const { context, urls, lines } = contextWith([
		{
			status: 200,
			body: '{"results":[1],"next_cursor":"forever"}',
		},
	]);
	const items = fetchAllTodoistPages(context, overdueTasksRequest());
	assert.equal(urls.length, 50);
	assert.equal(items.length, 50);
	assert.ok(lines.some((line) => line.includes("page budget")));
});

test("a single non-paginated page needs no second call", () => {
	const { context, urls, sleeps } = contextWith([
		{ status: 200, body: "[1,2,3]" },
	]);
	assert.deepEqual(
		fetchAllTodoistPages(context, overdueTasksRequest()),
		[1, 2, 3],
	);
	assert.equal(urls.length, 1);
	assert.deepEqual(sleeps, []);
});
