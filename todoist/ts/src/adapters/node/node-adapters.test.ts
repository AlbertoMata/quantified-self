import assert from "node:assert/strict";
import { test } from "node:test";

import { createNodeCacheStore } from "./node-cache-store.ts";
import { createNodeClock } from "./node-clock.ts";
import { createNodeIdGenerator } from "./node-id-generator.ts";
import { createNodeRuntime } from "./node-runtime.ts";

// ── the four that are real ───────────────────────────────────────────────────

test("sleep actually blocks, synchronously", () => {
	// The seam is synchronous because an Apps Script trigger cannot await, and
	// this is the Node side paying that bill. `await setTimeout()` is not
	// available to it, so Atomics.wait blocks the thread outright.
	const clock = createNodeClock();
	const before = Date.now();
	clock.sleep(40);
	assert.ok(
		Date.now() - before >= 35,
		"sleep must genuinely block, not return immediately",
	);
});

test("sleeping for nothing returns immediately", () => {
	const before = Date.now();
	createNodeClock().sleep(0);
	assert.ok(Date.now() - before < 20);
});

test("uuids are unique and correctly shaped", () => {
	// Todoist uses these as idempotency keys for /sync commands: a collision
	// would make the second command a silent no-op.
	const ids = createNodeIdGenerator();
	const first = ids.newUuid();
	assert.notEqual(first, ids.newUuid());
	assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);
});

test("the cache honours its ttl instead of ignoring it", () => {
	// Under Actions the process dies long before any TTL matters, but a
	// long-running local session is where a permanently stale project tree
	// would be a baffling thing to debug.
	let clockMillis = 1_000_000;
	const cache = createNodeCacheStore(() => clockMillis);

	cache.write("projects", '{"a":1}', 60);
	assert.equal(cache.read("projects"), '{"a":1}');

	clockMillis += 59_000;
	assert.equal(cache.read("projects"), '{"a":1}', "still inside the ttl");

	clockMillis += 2_000;
	assert.equal(cache.read("projects"), null, "expired");
});

test("a cache miss is null, never a throw", () => {
	assert.equal(createNodeCacheStore().read("never-written"), null);
});

// ── the three that are not ───────────────────────────────────────────────────

test("unimplemented ports fail loudly rather than returning something plausible", () => {
	// The failure this prevents: a TableStore that returned no rows would make
	// a pipeline compute a full rebuild from nothing and then try to write it.
	const runtime = createNodeRuntime();

	assert.throws(
		() => runtime.http.get("https://example.com", {}),
		/not implemented for Node/,
	);
	assert.throws(
		() => runtime.tables.readRows("Overdue_port"),
		/not implemented for Node/,
	);
	assert.throws(
		() => runtime.state.read("PORT_CURSOR"),
		/not implemented for Node/,
	);
});

test("the not-implemented message says which step will implement it", () => {
	const runtime = createNodeRuntime();
	assert.throws(
		() => runtime.tables.readRows("Overdue_port"),
		/planned for F2/,
	);
});

// ── the runtime as a whole ───────────────────────────────────────────────────

test("the Node runtime satisfies every port the seam declares", () => {
	// The point of building this in Phase B: F2 fills in blanks rather than
	// discovering the shape is wrong.
	const runtime = createNodeRuntime();
	for (const port of [
		"http",
		"tables",
		"state",
		"cache",
		"clock",
		"logger",
		"ids",
	]) {
		assert.ok(port in runtime, `Runtime is missing ${port}`);
	}
});

test("the Node runtime is guarded exactly like the Apps Script one", () => {
	// A misconfigured runner is if anything the more dangerous case: F1 gives a
	// service account Editor on the live spreadsheet, and until F5 this wrapper
	// is the only thing between it and four years of rows.
	//
	// The guard must refuse BEFORE the unimplemented store is reached — so this
	// asserts the tab-name error, not the not-implemented one.
	const runtime = createNodeRuntime();
	assert.throws(
		() => runtime.tables.appendRows("Overdue", [["2026-09-14"]]),
		/may only write tabs ending "_port"/,
	);
	assert.throws(
		() => runtime.state.write("TODOIST_LAST_SYNC", "x"),
		/may only write keys starting "PORT_"/,
	);
});
