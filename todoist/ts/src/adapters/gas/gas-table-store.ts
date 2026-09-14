// ─────────────────────────────────────────────────────────────────────────────
// TableStore over SpreadsheetApp
//
// The riskiest adapter in the project: it is the only one that can destroy data
// that cannot be re-fetched. Three rules shape it.
//
// BATCH, NEVER PER-ROW. One getRange().setValues() for n rows, never n calls.
// The legacy HabitDaily comment records why — per-row calls against a few
// thousand rows are what turn a nightly run into a 6-minute timeout.
//
// CLEAR, DON'T DELETE, for anything that empties a tab. Sheets refuses to
// delete every unfrozen row once the header is frozen ("No puedes borrar todas
// las filas móviles"), which both BillCycle and HabitDaily hit in production.
//
// RECTANGULAR OR NOTHING. setValues() rejects a ragged array, so rows are
// padded to a single width before they go anywhere near the sheet. A pipeline
// that builds a short row for a usually-blank trailing column would otherwise
// fail at the last possible moment, after the fetch has already been paid for.
// ─────────────────────────────────────────────────────────────────────────────

import { padRow } from "../../core/row.ts";
import type { TableStore } from "../../ports/table-store.ts";
import type { CellValue, Row, TableName } from "../../ports/values.ts";
import type {
	GasSheet,
	GasSpreadsheet,
	GasSpreadsheetApp,
} from "./gas-types.ts";

// Rows must be rectangular for setValues(). Widen every row to the widest one.
function toRectangle(rows: readonly Row[]): CellValue[][] {
	let width = 0;
	for (const row of rows) width = Math.max(width, row.length);
	return rows.map((row) => [...padRow(row, width)]);
}

export function createGasTableStore(
	spreadsheetApp: GasSpreadsheetApp,
	spreadsheetId: string,
): TableStore {
	// Opened once. openById is a network call in disguise, and the legacy code
	// pays for it 16 separate times across a single nightly run.
	let spreadsheet: GasSpreadsheet | null = null;
	const openSpreadsheet = (): GasSpreadsheet => {
		spreadsheet ??= spreadsheetApp.openById(spreadsheetId);
		return spreadsheet;
	};

	const sheetCache = new Map<TableName, GasSheet>();

	function findSheet(tab: TableName): GasSheet | null {
		const cached = sheetCache.get(tab);
		if (cached) return cached;
		const sheet = openSpreadsheet().getSheetByName(tab);
		if (sheet) sheetCache.set(tab, sheet);
		return sheet;
	}

	function requireSheet(tab: TableName): GasSheet {
		const sheet = findSheet(tab);
		if (!sheet) {
			throw new Error(
				`Tab "${tab}" does not exist. Call ensureTable() before writing — ` +
					`nothing here creates a tab implicitly, because a typo in a tab ` +
					`name would otherwise silently produce a second, empty one.`,
			);
		}
		return sheet;
	}

	return {
		readRows(tab: TableName): Row[] {
			const sheet = findSheet(tab);
			if (!sheet) return [];
			// A brand-new sheet reports lastRow 0 but getDataRange() still
			// hands back [[""]] — one blank cell. Asking first avoids turning
			// an empty tab into a phantom row.
			if (sheet.getLastRow() === 0) return [];
			return sheet.getDataRange().getValues();
		},

		hasTable(tab: TableName): boolean {
			return findSheet(tab) !== null;
		},

		ensureTable(tab: TableName, header: Row): void {
			if (findSheet(tab)) return; // idempotent, by contract
			const sheet = openSpreadsheet().insertSheet(tab);
			sheetCache.set(tab, sheet);
			sheet.getRange(1, 1, 1, header.length).setValues(
				toRectangle([header]),
			);
		},

		appendRows(tab: TableName, rows: readonly Row[]): void {
			if (rows.length === 0) return;
			const sheet = requireSheet(tab);
			const values = toRectangle(rows);
			const firstRow = sheet.getLastRow() + 1;
			const width = values[0]?.length ?? 0;
			sheet.getRange(
				firstRow,
				1,
				values.length,
				width,
			).setValues(values);
		},

		writeRows(
			tab: TableName,
			firstRow: number,
			rows: readonly Row[],
		): void {
			if (rows.length === 0) return;
			const sheet = requireSheet(tab);
			const values = toRectangle(rows);
			const width = values[0]?.length ?? 0;
			sheet.getRange(
				firstRow,
				1,
				values.length,
				width,
			).setValues(values);
		},

		deleteRows(
			tab: TableName,
			firstRow: number,
			count: number,
		): void {
			if (count <= 0) return;
			requireSheet(tab).deleteRows(firstRow, count);
		},

		clearRowsFrom(tab: TableName, firstRow: number): void {
			const sheet = requireSheet(tab);
			const lastRow = sheet.getLastRow();
			if (lastRow < firstRow) return; // nothing below to clear

			// getMaxColumns(), not getLastColumn(): a stale value parked in a
			// column beyond the current data would survive a clear that only
			// covered the populated width, and then reappear as a ghost cell
			// the next time something read the whole range.
			sheet.getRange(
				firstRow,
				1,
				lastRow - firstRow + 1,
				sheet.getMaxColumns(),
			).clearContent();
		},
	};
}
