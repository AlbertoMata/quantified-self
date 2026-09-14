// The five smaller adapters, each against a fake of its Google global.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
	FakeCacheService,
	FakeGasLogger,
	FakePropertiesService,
	FakeUrlFetchApp,
	FakeUtilities,
} from "./fake-gas.ts";
import { createGasCacheStore } from "./gas-cache-store.ts";
import { createGasClock } from "./gas-clock.ts";
import { createGasHttpTransport } from "./gas-http.ts";
import { createGasIdGenerator } from "./gas-id-generator.ts";
import { createGasKeyValueStore } from "./gas-key-value-store.ts";
import { createGasLogger } from "./gas-logger.ts";

// ── HttpTransport ────────────────────────────────────────────────────────────

test("every request mutes http exceptions, so the body survives an error", () => {
	// Without this UrlFetchApp throws on non-2xx and takes the response body
	// with it — and Todoist's 429 body is the part worth reading.
	const urlFetchApp = new FakeUrlFetchApp();
	const http = createGasHttpTransport(urlFetchApp);

	http.get("https://api.todoist.com/rest/v2/tasks", {
		Authorization: "Bearer x",
	});
	http.post(
		"https://api.todoist.com/sync/v9/sync",
		{},
		'{"commands":[]}',
	);

	assert.equal(urlFetchApp.calls.length, 2);
	for (const call of urlFetchApp.calls) {
		assert.equal(call.options.muteHttpExceptions, true);
	}
});

test("a 429 comes back as data, not as a throw", () => {
	const http = createGasHttpTransport(
		new FakeUrlFetchApp({
			status: 429,
			body: '{"error":"slow down"}',
		}),
	);
	const response = http.get("https://api.todoist.com/rest/v2/tasks", {});
	assert.equal(response.status, 429);
	assert.match(response.body, /slow down/);
});

test("a post sends JSON content type and the payload", () => {
	// contentType is a separate field in the UrlFetchApp API — setting it only
	// inside headers is ignored, and /sync then rejects the body.
	const urlFetchApp = new FakeUrlFetchApp();
	createGasHttpTransport(urlFetchApp).post(
		"https://api.todoist.com/sync/v9/sync",
		{ Authorization: "Bearer x" },
		'{"commands":[1]}',
	);
	const call = urlFetchApp.calls[0];
	assert.ok(call);
	assert.equal(call.options.contentType, "application/json");
	assert.equal(call.options.payload, '{"commands":[1]}');
	assert.equal(call.options.headers?.["Authorization"], "Bearer x");
});

// ── KeyValueStore ────────────────────────────────────────────────────────────

test("a missing property reads as null, which is a real state", () => {
	// "No cursor yet" has its own branch: the first Completions run backfills
	// instead of fetching a window.
	const store = createGasKeyValueStore(new FakePropertiesService());
	assert.equal(store.read("PORT_TODOIST_LAST_SYNC"), null);
});

test("the properties handle is acquired once, not per call", () => {
	const service = new FakePropertiesService();
	const store = createGasKeyValueStore(service);
	store.read("a");
	store.write("b", "1");
	store.read("b");
	assert.equal(service.acquisitions, 1);
});

test("a written property reads back", () => {
	const store = createGasKeyValueStore(new FakePropertiesService());
	store.write("PORT_TODOIST_LAST_SYNC", "2026-09-14T05:30:00Z");
	assert.equal(
		store.read("PORT_TODOIST_LAST_SYNC"),
		"2026-09-14T05:30:00Z",
	);
});

// ── CacheStore ───────────────────────────────────────────────────────────────

test("a cache write carries the ttl it was given", () => {
	const service = new FakeCacheService();
	createGasCacheStore(service).write("projects", '{"a":1}', 21600);
	assert.equal(service.cache.values.get("projects")?.ttl, 21600);
});

test("an oversized value is refused rather than silently dropped", () => {
	// CacheService discards anything over 100KB without a word, so every later
	// read would miss for ever — a performance bug with no symptom.
	const store = createGasCacheStore(new FakeCacheService());
	const tooBig = "x".repeat(100 * 1024 + 1);
	assert.throws(
		() => store.write("tasks", tooBig, 21600),
		/over CacheService's/,
	);
});

test("the size limit counts bytes, not characters", () => {
	// Project names carry emoji (💼 Work) — four bytes each. A character count
	// would let a value 4x over the limit through.
	const store = createGasCacheStore(new FakeCacheService());
	const emoji = "💼".repeat(26 * 1024); // 26k chars, ~104KB
	assert.throws(
		() => store.write("tree", emoji, 21600),
		/over CacheService's/,
	);
});

test("a value just under the limit is accepted", () => {
	const service = new FakeCacheService();
	createGasCacheStore(service).write("ok", "x".repeat(100 * 1024), 21600);
	assert.ok(service.cache.get("ok"));
});

// ── Clock ────────────────────────────────────────────────────────────────────

test("sleep goes through Utilities, and now returns a real instant", () => {
	const utilities = new FakeUtilities();
	const clock = createGasClock(utilities);
	clock.sleep(300);
	clock.sleep(400);
	assert.deepEqual(utilities.sleeps, [300, 400]);
	assert.ok(clock.now() instanceof Date);
});

// ── Logger ───────────────────────────────────────────────────────────────────

test("log lines reach the platform logger verbatim", () => {
	const gasLogger = new FakeGasLogger();
	createGasLogger(gasLogger).log(
		"Completions: 14 new, 3 duplicates skipped",
	);
	assert.deepEqual(gasLogger.lines, [
		"Completions: 14 new, 3 duplicates skipped",
	]);
});

// ── IdGenerator ──────────────────────────────────────────────────────────────

test("every command gets its own uuid", () => {
	// Todoist uses the uuid for idempotency: a reused one makes the second
	// command a silent no-op, so a batch would half-apply.
	const ids = createGasIdGenerator(new FakeUtilities());
	assert.notEqual(ids.newUuid(), ids.newUuid());
});
