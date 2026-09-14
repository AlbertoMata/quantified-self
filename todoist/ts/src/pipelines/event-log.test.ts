// D12 — the event-log webhook. The port's only inbound path, and the only one
// whose caller will not retry.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
	aliveResponse,
	buildLogEventRow,
	errorResponse,
	EVENT_LOG_HEADER,
	okResponse,
	parseLogEventBody,
} from "./event-log.ts";

const NOW = new Date("2026-09-14T17:00:00Z");

test("a full event becomes the row the schema declares", () => {
	const row = buildLogEventRow(
		{
			timestamp: "2026-09-14T07:02:00Z",
			event_type: "coffee",
			value: "1",
			notes: "double shot",
			source: "watch",
		},
		NOW,
	);
	assert.equal(row.length, EVENT_LOG_HEADER.length);
	assert.deepEqual(row, [
		"2026-09-14T07:02:00Z",
		"coffee",
		"1",
		"double shot",
		"watch",
	]);
});

test("the Shortcut's OWN timestamp wins over the server clock", () => {
	// The watch may be offline when the event happens, so the device timestamp
	// is the accurate one. Overwriting it would file every queued event at the
	// moment it finally uploaded.
	const row = buildLogEventRow(
		{ timestamp: "2026-09-13T22:00:00Z" },
		NOW,
	);
	assert.equal(row[0], "2026-09-13T22:00:00Z");
});

test("a missing timestamp falls back to now", () => {
	assert.equal(buildLogEventRow({}, NOW)[0], NOW.toISOString());
});

test("a missing event_type becomes `custom`, not blank", () => {
	// An event with no type is still an event; a blank cell would be invisible
	// in every chart.
	assert.equal(buildLogEventRow({}, NOW)[1], "custom");
});

test("both `notes` and `note` are accepted", () => {
	// Both spellings have existed in Shortcuts in the wild.
	assert.equal(
		buildLogEventRow({ note: "via note" }, NOW)[3],
		"via note",
	);
	assert.equal(
		buildLogEventRow({ notes: "via notes" }, NOW)[3],
		"via notes",
	);
	assert.equal(
		buildLogEventRow({ notes: "wins", note: "loses" }, NOW)[3],
		"wins",
	);
});

test("a numeric value is stringified rather than dropped", () => {
	// A Shortcut sends whatever the user typed; JSON makes it a number.
	assert.equal(buildLogEventRow({ value: 3 }, NOW)[2], "3");
	assert.equal(buildLogEventRow({ value: 0 }, NOW)[2], "0");
});

test("an empty body still produces a complete row", () => {
	// Losing an event because a field was missing is the worst outcome here —
	// the device will not retry.
	const row = buildLogEventRow({}, NOW);
	assert.equal(row.length, EVENT_LOG_HEADER.length);
	assert.deepEqual(row.slice(1), ["custom", "", "", "shortcut"]);
});

// ── responses ────────────────────────────────────────────────────────────────

test("a malformed body is reported, not thrown past the handler", () => {
	// A thrown error reaches a Shortcut as an opaque failure the phone shows no
	// useful message for, and the event is simply lost.
	assert.throws(() => parseLogEventBody(""), /empty request body/);
	assert.throws(
		() => parseLogEventBody("[1,2]"),
		/must be a JSON object/,
	);
	assert.throws(() => parseLogEventBody(undefined), /empty request body/);
});

test("a valid body parses", () => {
	assert.deepEqual(parseLogEventBody('{"event_type":"coffee"}'), {
		event_type: "coffee",
	});
});

test("the responses are the JSON shapes the Shortcuts expect", () => {
	assert.deepEqual(JSON.parse(okResponse().body), { status: "ok" });
	assert.deepEqual(JSON.parse(aliveResponse().body), { status: "alive" });

	const failure = JSON.parse(errorResponse(new Error("boom")).body);
	assert.equal(failure.status, "error");
	assert.equal(failure.message, "boom");
});

test("a non-Error thrown value still yields a readable message", () => {
	assert.equal(
		JSON.parse(errorResponse("just a string").body).message,
		"just a string",
	);
});
