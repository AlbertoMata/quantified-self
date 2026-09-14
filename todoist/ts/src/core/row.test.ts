import assert from "node:assert/strict";
import { test } from "node:test";

import type { Row } from "../ports/values.ts";
import { cellAsText, cellAt, columnIndex, padRow } from "./row.ts";

const HEADER: Row = ["day", "task_id", "area", "was_overdue"];

test("columnIndex finds a column by name", () => {
	assert.equal(columnIndex(HEADER, "day"), 0);
	assert.equal(columnIndex(HEADER, "was_overdue"), 3);
});

test("columnIndex throws with the header it actually saw", () => {
	// The failure mode this prevents is the expensive one: the legacy layout
	// guard responds to an unexpected header by archiving the tab and starting
	// an empty one, which breaks every Looker source bound to it.
	assert.throws(
		() => columnIndex(HEADER, "area_source"),
		/not in the header.*day, task_id, area, was_overdue/s,
	);
});

test("a short row reads as absent, not as a crash", () => {
	// Sheets returns only as many columns as have ever been written, so a tab
	// whose last column is usually blank yields rows that stop early.
	const short: Row = ["2026-09-14", "abc"];
	assert.equal(cellAt(short, 3), null);
	assert.equal(cellAsText(short, 3), "");
});

test("cellAsText trims and normalises, and never invents a value", () => {
	const row: Row = ["  2026-09-14  ", 42, null, false];
	assert.equal(cellAsText(row, 0), "2026-09-14");
	assert.equal(cellAsText(row, 1), "42");
	assert.equal(cellAsText(row, 2), "");
	assert.equal(cellAsText(row, 3), "false");
});

test("padRow fills to the header width", () => {
	assert.deepEqual(padRow(["a"], 3), ["a", null, null]);
	assert.deepEqual(padRow(["a", "b", "c"], 3), ["a", "b", "c"]);
});

test("padRow refuses a row wider than the header", () => {
	// Writing past the declared columns is how a tab silently grows a column
	// that no schema doc describes.
	assert.throws(
		() => padRow(["a", "b", "c", "d"], 3),
		/4 cells but the header has 3/,
	);
});
