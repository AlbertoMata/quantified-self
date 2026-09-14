import assert from "node:assert/strict";
import { test } from "node:test";

import type { Row } from "../../ports/values.ts";
import { FakeSheet, FakeSpreadsheetApp } from "./fake-gas.ts";
import { createGasTableStore } from "./gas-table-store.ts";

const HEADER: Row = ["day", "task_id", "count"];

function setUp(rows: Row[] = []) {
	const app = new FakeSpreadsheetApp();
	const sheet = new FakeSheet();
	app.spreadsheet.sheets.set("Overdue_port", sheet);
	if (rows.length > 0) {
		sheet.grid = rows.map((row) => [...row]);
	}
	return { app, sheet, store: createGasTableStore(app, "sheet-id") };
}

test("an empty tab reads as no rows, not as one blank row", () => {
	// getDataRange() on a fresh sheet returns [[""]], which would otherwise
	// become a phantom row and make the resolver think there is data.
	const { store } = setUp();
	assert.deepEqual(store.readRows("Overdue_port"), []);
});

test("a missing tab reads as empty rather than throwing", () => {
	// The *_port tabs do not exist until something creates them, so "missing"
	// is a normal state during the port, not an error.
	const { store } = setUp();
	assert.deepEqual(store.readRows("HabitDaily_port"), []);
	assert.equal(store.hasTable("HabitDaily_port"), false);
});

test("the spreadsheet is opened once, however many tabs are touched", () => {
	// openById is a network call in disguise; the legacy code pays for it 16
	// times in a single nightly run.
	const { app, store } = setUp([HEADER]);
	store.readRows("Overdue_port");
	store.readRows("Overdue_port");
	store.hasTable("Overdue_port");
	assert.deepEqual(app.opened, ["sheet-id"]);
});

test("ensureTable creates a tab with its header, and is idempotent", () => {
	const { app, store } = setUp();
	store.ensureTable("TaskDaily_port", HEADER);
	const created = app.spreadsheet.sheets.get("TaskDaily_port");
	assert.ok(created);
	assert.deepEqual(created.grid[0], HEADER);

	store.appendRows("TaskDaily_port", [["2026-09-14", "a", 1]]);
	store.ensureTable("TaskDaily_port", HEADER);
	assert.equal(
		created.getLastRow(),
		2,
		"a second ensureTable must not wipe the rows already there",
	);
});

test("writing to a tab that does not exist fails loudly", () => {
	// A typo in a tab name must not quietly produce a second, empty tab.
	const { store } = setUp();
	assert.throws(
		() => store.appendRows("Ovredue_port", [["x"]]),
		/does not exist. Call ensureTable/,
	);
});

test("appendRows lands after the last populated row", () => {
	const { sheet, store } = setUp([HEADER, ["2026-09-13", "a", 1]]);
	store.appendRows("Overdue_port", [["2026-09-14", "b", 2]]);
	assert.equal(sheet.getLastRow(), 3);
	assert.deepEqual(sheet.grid[2], ["2026-09-14", "b", 2]);
});

test("short rows are padded, because setValues rejects a ragged array", () => {
	// A pipeline that omits a usually-blank trailing column would otherwise
	// fail at the very last step, after the fetch has already been paid for.
	const { sheet, store } = setUp([HEADER]);
	store.appendRows("Overdue_port", [
		["2026-09-14", "a", 1],
		["2026-09-14", "b"], // one cell short
	]);
	assert.deepEqual(sheet.grid[2], ["2026-09-14", "b", null]);
});

test("writeRows overwrites in place without disturbing rows below", () => {
	const { sheet, store } = setUp([
		HEADER,
		["2026-09-12", "a", 1],
		["2026-09-13", "b", 2],
		["2026-09-14", "c", 3],
	]);
	store.writeRows("Overdue_port", 3, [["2026-09-13", "REPLACED", 9]]);
	assert.deepEqual(sheet.grid[2], ["2026-09-13", "REPLACED", 9]);
	assert.deepEqual(sheet.grid[3], ["2026-09-14", "c", 3]);
});

test("clearRowsFrom blanks the tail and leaves the header", () => {
	// The operation that replaces deleteRows for a full rebuild — Sheets
	// refuses to delete every unfrozen row once the header is frozen.
	const { sheet, store } = setUp([
		HEADER,
		["2026-09-13", "a", 1],
		["2026-09-14", "b", 2],
	]);
	store.clearRowsFrom("Overdue_port", 2);

	assert.equal(sheet.getLastRow(), 1, "only the header should remain");
	assert.deepEqual(sheet.grid[0], HEADER);
	assert.equal(
		sheet.grid.length,
		3,
		"the rows themselves must still exist",
	);
});

test("clearRowsFrom covers the full column width, not just the populated one", () => {
	// A stale value parked beyond the current data would survive a narrower
	// clear and reappear as a ghost cell on the next whole-range read.
	const { sheet, store } = setUp([HEADER, ["2026-09-14", "a", 1]]);
	sheet.grid[1] = ["2026-09-14", "a", 1, "", "", "stale-ghost"];

	store.clearRowsFrom("Overdue_port", 2);
	assert.equal(sheet.getLastRow(), 1);
});

test("clearRowsFrom below the last row is a no-op", () => {
	const { sheet, store } = setUp([HEADER]);
	store.clearRowsFrom("Overdue_port", 2);
	assert.deepEqual(sheet.grid[0], HEADER);
});

test("appending nothing touches the sheet not at all", () => {
	const { sheet, store } = setUp([HEADER]);
	store.appendRows("Overdue_port", []);
	store.writeRows("Overdue_port", 2, []);
	assert.equal(sheet.getLastRow(), 1);
});
