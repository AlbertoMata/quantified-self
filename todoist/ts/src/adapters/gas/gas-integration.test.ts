// The two halves meeting: a WritePlan applied through the real GAS adapter.
//
// Every other test checks one side. This checks the assumption that joins them,
// and it is not an obvious one: the resolver emits `clearFrom(n)` followed by
// `write(n)` for the SAME row, which is only correct because clearContent()
// blanks cells and leaves the rows in place. If clearing removed rows instead,
// the write would land in a gap and every replaceWhere would corrupt its tab.

import assert from "node:assert/strict";
import { test } from "node:test";

import { applyWritePlan } from "../../core/apply-write-plan.ts";
import { appendTo, replaceWhere, upsertBy } from "../../core/write-plan.ts";
import type { KeyValueStore } from "../../ports/key-value-store.ts";
import type { Logger } from "../../ports/logger.ts";
import type { Row } from "../../ports/values.ts";
import {
	FakeSheet,
	FakePropertiesService,
	FakeSpreadsheetApp,
} from "./fake-gas.ts";
import { createGasKeyValueStore } from "./gas-key-value-store.ts";
import { createGasTableStore } from "./gas-table-store.ts";

const HEADER: Row = ["day", "task_id", "count"];

function setUp(rows: Row[]) {
	const app = new FakeSpreadsheetApp();
	const sheet = new FakeSheet();
	sheet.grid = rows.map((row) => [...row]);
	app.spreadsheet.sheets.set("Overdue_port", sheet);

	const tables = createGasTableStore(app, "sheet-id");
	const state: KeyValueStore = createGasKeyValueStore(
		new FakePropertiesService(),
	);
	const lines: string[] = [];
	const logger: Logger = { log: (message) => lines.push(message) };
	return { sheet, tables, state, logger, lines };
}

// Read back what a human would see: rows up to the last populated one, with
// trailing blanks trimmed.
//
// The trim is not cosmetic. clearRowsFrom deliberately clears the sheet's FULL
// column width so no stale value can survive beyond the data, so a cleared row
// that is then rewritten with three cells really does carry blank cells out to
// column Z. That is correct and invisible in the sheet — but it means a
// row-by-row comparison has to ignore them.
function populated(sheet: FakeSheet): Row[] {
	return sheet.grid.slice(0, sheet.getLastRow()).map((row) => {
		const trimmed = [...row];
		while (
			trimmed.length > 0 &&
			(trimmed[trimmed.length - 1] === "" ||
				trimmed[trimmed.length - 1] === null)
		) {
			trimmed.pop();
		}
		return trimmed;
	});
}

test("replaceWhere clears and rewrites at the same row", () => {
	const { sheet, tables, state, logger } = setUp([
		HEADER,
		["2026-09-12", "a", 1],
		["2026-09-13", "b", 2],
		["2026-09-14", "stale-1", 8],
		["2026-09-14", "stale-2", 9],
	]);

	applyWritePlan(
		{
			writes: [
				replaceWhere(
					"Overdue_port",
					0,
					{ equals: "2026-09-14" },
					[["2026-09-14", "fresh", 1]],
				),
			],
			stateToPersist: {},
			logLines: [],
		},
		tables,
		state,
		logger,
	);

	assert.deepEqual(populated(sheet), [
		HEADER,
		["2026-09-12", "a", 1],
		["2026-09-13", "b", 2],
		["2026-09-14", "fresh", 1],
	]);
});

test("a full rebuild leaves the header and exactly the new rows", () => {
	const { sheet, tables, state, logger } = setUp([
		HEADER,
		["2026-09-12", "a", 1],
		["2026-09-13", "b", 2],
		["2026-09-14", "c", 3],
	]);

	applyWritePlan(
		{
			writes: [
				replaceWhere(
					"BillCycle_port",
					0,
					{ all: true },
					[],
				),
				replaceWhere("Overdue_port", 0, { all: true }, [
					["2026-09-14", "only", 1],
				]),
			],
			stateToPersist: {},
			logLines: [],
		},
		tables,
		state,
		logger,
	);

	assert.deepEqual(populated(sheet), [HEADER, ["2026-09-14", "only", 1]]);
});

test("an operation on a tab that does not exist yet is a no-op", () => {
	// Worth pinning: the *_port tabs do not exist until ensureTable creates
	// them, so a plan that mentions one before its first run must not throw and
	// must not create a stray tab.
	const { tables, state, logger } = setUp([HEADER]);
	assert.doesNotThrow(() =>
		applyWritePlan(
			{
				writes: [
					replaceWhere(
						"HabitDaily_port",
						0,
						{ all: true },
						[],
					),
				],
				stateToPersist: {},
				logLines: [],
			},
			tables,
			state,
			logger,
		),
	);
	assert.equal(tables.hasTable("HabitDaily_port"), false);
});

test("a shrinking rebuild leaves no ghost rows behind", () => {
	// Four rows replaced by one. Without the clear, rows 3-5 would survive
	// underneath the new row and the tab would read as five days of data.
	const { sheet, tables, state, logger } = setUp([
		HEADER,
		["2026-09-14", "a", 1],
		["2026-09-14", "b", 2],
		["2026-09-14", "c", 3],
		["2026-09-14", "d", 4],
	]);

	applyWritePlan(
		{
			writes: [
				replaceWhere(
					"Overdue_port",
					0,
					{ equals: "2026-09-14" },
					[["2026-09-14", "only", 1]],
				),
			],
			stateToPersist: {},
			logLines: [],
		},
		tables,
		state,
		logger,
	);

	assert.equal(sheet.getLastRow(), 2);
	assert.deepEqual(populated(sheet)[1], ["2026-09-14", "only", 1]);
});

test("append then upsert through the adapter, in one plan", () => {
	const { sheet, tables, state, logger } = setUp([
		HEADER,
		["2026-09-13", "k", 1],
	]);

	applyWritePlan(
		{
			writes: [
				appendTo("Overdue_port", [
					["2026-09-14", "k", 2],
				]),
				// Resolved against the tab as it is AFTER the append above.
				upsertBy("Overdue_port", 0, [
					["2026-09-13", "k", 111],
					["2026-09-15", "k", 3],
				]),
			],
			stateToPersist: {
				PORT_TODOIST_LAST_SYNC: "2026-09-14T05:30:00Z",
			},
			logLines: [],
		},
		tables,
		state,
		logger,
	);

	assert.deepEqual(populated(sheet), [
		HEADER,
		["2026-09-13", "k", 111],
		["2026-09-14", "k", 2],
		["2026-09-15", "k", 3],
	]);
	assert.equal(
		state.read("PORT_TODOIST_LAST_SYNC"),
		"2026-09-14T05:30:00Z",
		"state must be persisted once the rows are in",
	);
});

test("a dry run against the real adapter writes no cell at all", () => {
	const { sheet, tables, state, logger } = setUp([
		HEADER,
		["2026-09-14", "untouched", 1],
	]);

	applyWritePlan(
		{
			writes: [
				replaceWhere("Overdue_port", 0, { all: true }, [
					["2026-09-14", "would-replace", 9],
				]),
			],
			stateToPersist: { PORT_CURSOR: "x" },
			logLines: [],
		},
		tables,
		state,
		logger,
		{ dryRun: true },
	);

	assert.deepEqual(populated(sheet), [
		HEADER,
		["2026-09-14", "untouched", 1],
	]);
	assert.equal(state.read("PORT_CURSOR"), null);
});
