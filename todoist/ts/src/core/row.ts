// ─────────────────────────────────────────────────────────────────────────────
// Rows and columns
//
// A tab is a column-ordered contract: todoist/schema/*.md defines what sits in
// which position, and the legacy code reaches those positions through constants
// like HABIT_DAILY_STREAK_COL. Positions are fine — they are the sheet's actual
// model — but hand-maintained index constants are how a tab acquires a column
// and quietly shifts everything to its right.
//
// So columns are looked up BY NAME against the header the pipeline declares,
// once, and the resulting index is used for the whole run.
// ─────────────────────────────────────────────────────────────────────────────

import type { CellValue, Row } from "../ports/values.ts";

// The 0-based index of a column, by header name.
//
// Throws rather than returning -1. A missing column means the tab's layout is
// not what this code was written against, and the legacy behaviour on that —
// archiveAndRecreateSheet(), which renames your tab and starts an empty one —
// is precisely the outcome worth failing loudly to avoid.
export function columnIndex(header: Row, name: string): number {
	const index = header.findIndex(
		(cell) => typeof cell === "string" && cell.trim() === name,
	);
	if (index === -1) {
		const present = header
			.map((cell) => (cell === null ? "" : String(cell)))
			.join(", ");
		throw new Error(
			`Column "${name}" is not in the header. Present: [${present}]. ` +
				`Either the tab's layout changed or the header constant is stale — ` +
				`check the schema doc in todoist/schema/ before writing anything.`,
		);
	}
	return index;
}

// Read one cell, tolerating a row shorter than the header.
//
// Short rows are normal, not exceptional: a sheet returns only as many columns
// as have ever been written, so a tab whose last column is usually blank yields
// rows that stop early. noUncheckedIndexedAccess already forces this to be
// handled; this makes the handling uniform and the absence explicit.
export function cellAt(row: Row, index: number): CellValue {
	return index < row.length ? (row[index] ?? null) : null;
}

// A cell as a trimmed string. Empty and null both become "".
//
// Note what this does NOT do: it will happily stringify a Date, which is almost
// never what you want for a date column — that is core/dates.ts's job in C1,
// where the timezone is an explicit argument. Use this for text columns.
export function cellAsText(row: Row, index: number): string {
	const value = cellAt(row, index);
	if (value === null) return "";
	if (value instanceof Date) return value.toISOString();
	return String(value).trim();
}

// Pad a row out to the header's width with nulls.
//
// Rows must be rectangular before they reach the sheet: setValues() rejects a
// ragged array outright, and a pipeline that builds a short row for a mostly
// empty trailing column would otherwise fail at the very last step, after the
// fetch has already been paid for.
export function padRow(row: Row, width: number): Row {
	if (row.length === width) return row;
	if (row.length > width) {
		throw new Error(
			`Row has ${row.length} cells but the header has ${width}. ` +
				`A wider row would write past the declared columns.`,
		);
	}
	return [...row, ...new Array<CellValue>(width - row.length).fill(null)];
}
