// ─────────────────────────────────────────────────────────────────────────────
// TableStore — the spreadsheet, reduced to what the syncs actually do to it
//
// The ten legacy .gs files touch a sheet through five operations and no more:
// read everything, append rows, overwrite a block, delete a contiguous run, and
// create a missing tab. Everything else they do — sorting, deduping, deciding
// which rows to replace — happens in memory on the values, which is precisely
// why the pure core can own it.
//
// This interface is deliberately row-oriented rather than range-oriented. No
// A1 notation, no 1-based column arithmetic leaking upward: getRange(2, 1, n, m)
// is an Apps Script detail that has no meaning to the Sheets API adapter, and
// off-by-one errors in that arithmetic are exactly the bugs the port should not
// carry across.
//
// WHERE THE SAFETY RAIL LIVES: B4b makes the GAS implementation refuse any tab
// name not ending "_port" unless allowProductionTabs is explicitly true. That
// guard belongs to the adapter, not to this interface — an interface that could
// not name a production tab could not describe the legacy behaviour it must
// eventually replace at E4.
// ─────────────────────────────────────────────────────────────────────────────

import type { Row, TableName } from "./values.ts";

export interface TableStore {
	// Every row including the header, in sheet order — the shape
	// getDataRange().getValues() already returns. An empty tab gives [].
	//
	// Whole-tab reads are the existing behaviour, not a simplification: the
	// pipelines need the prior state in memory to compute a plan, and the
	// largest tab here is a few thousand rows.
	readRows(tab: TableName): Row[];

	// True if the tab exists. Worth asking rather than catching a throw,
	// because "missing" is a normal state during the port: the *_port shadow
	// tabs do not exist until something creates them.
	hasTable(tab: TableName): boolean;

	// Create the tab with this header row. Must be a no-op — NOT an error and
	// NOT a wipe — if the tab already exists, so that a pipeline can call it
	// unconditionally on every run.
	//
	// This is what creates the *_port tabs of Phase D. Nothing else does, and
	// nothing did before: the legacy code assumes its tabs already exist.
	ensureTable(tab: TableName, header: Row): void;

	// Add rows after the last populated row. The append-only path, used by
	// Completions — the tab where losing a row loses history permanently.
	appendRows(tab: TableName, rows: readonly Row[]): void;

	// Overwrite a block of rows starting at a 1-based sheet row number,
	// matching what a human reads off the row gutter. Writes exactly
	// rows.length rows and touches nothing below them.
	writeRows(tab: TableName, firstRow: number, rows: readonly Row[]): void;

	// Delete `count` rows starting at a 1-based sheet row number. Separate from
	// writeRows because deletion SHIFTS everything below it upward, which is
	// the one operation here that can corrupt a tab wholesale if the caller has
	// stale indices. Callers must compute positions from a single read and
	// delete from the bottom up.
	deleteRows(tab: TableName, firstRow: number, count: number): void;

	// Blank every cell from a 1-based sheet row to the end of the tab, leaving
	// the (now empty) grid rows in place.
	//
	// ⚠️ NOT a convenience for deleteRows — it is the only thing that works for
	// a full rebuild. Sheets refuses to delete every unfrozen row ("No puedes
	// borrar todas las filas móviles") the moment the header row is frozen,
	// which it is as soon as anyone freezes it by hand or converts the tab to a
	// table. Both `BillCycle` (full rebuild) and `HabitDaily` (window rebuild)
	// hit this in production and both switched to clearing; the comments in
	// todoist-bill-cycle.gs and todoist-habit-daily.gs record it.
	//
	// Clearing leaves the rows there, so the rewrite lands straight back on top
	// of them — which is why the applier clears, then writes at the same row.
	clearRowsFrom(tab: TableName, firstRow: number): void;
}
