// ─────────────────────────────────────────────────────────────────────────────
// The values that cross the seam
//
// A spreadsheet cell is not a string. Apps Script hands back whatever type the
// cell holds — a Date for a date cell, a number for a number cell, "" for an
// empty one — and the Sheets API under Node will do the same through a
// different code path. Pretending everything is a string is how a date column
// silently becomes "Sat Sep 13 2026 00:00:00 GMT-0600" in a tab that Looker
// then refuses to chart.
//
// So the seam is typed honestly, and parsing a cell into something useful is a
// job for core/ — where it can be tested — rather than a job for the adapter.
// ─────────────────────────────────────────────────────────────────────────────

// What a single cell can hold, on either runtime.
export type CellValue = string | number | boolean | Date | null;

// One row of a tab, in column order. Rows are plain arrays rather than objects
// because the tabs are column-ordered contracts: the schema docs in
// todoist/schema/ define position, and a header constant maps name to index.
export type Row = readonly CellValue[];

// A tab name, as it appears on the sheet tab. Named for readability at call
// sites — `readRows(tab)` reads better than `readRows(name: string)`, and it
// marks every place the *_port suffix rule of B4b applies.
export type TableName = string;
