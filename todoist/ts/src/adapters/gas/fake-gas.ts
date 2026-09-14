// In-memory stand-ins for the Apps Script globals.
//
// Not test-only helpers by accident — they are the reason the adapters take
// their API as an argument. Everything in adapters/gas/ except gas-runtime.ts
// can therefore be exercised under plain Node, which is the difference between
// "the adapter compiles" and "the adapter writes to the right cells".
//
// The sheet fake models the two Sheets behaviours that actually bite:
//   * a range write is REGION-based, so writing at row 9 of a 3-row sheet
//     leaves a gap rather than appending;
//   * clearContent() blanks cells and LEAVES the rows, which is what makes
//     getLastRow() shrink afterwards rather than the rows disappearing.

import type { CellValue } from "../../ports/values.ts";
import type {
	GasCache,
	GasCacheService,
	GasFetchOptions,
	GasHttpResponse,
	GasLogger,
	GasProperties,
	GasPropertiesService,
	GasRange,
	GasSheet,
	GasSpreadsheet,
	GasSpreadsheetApp,
	GasUrlFetchApp,
	GasUtilities,
} from "./gas-types.ts";

export class FakeSheet implements GasSheet {
	// Sparse on purpose: a real sheet's cells exist independently of whether
	// anything was ever written to them.
	grid: CellValue[][] = [];
	maxColumns: number;

	constructor(maxColumns = 26) {
		this.maxColumns = maxColumns;
	}

	getLastRow(): number {
		// The last row holding any non-blank cell — which is how Sheets
		// computes it, and why clearing the tail makes it shrink.
		for (let index = this.grid.length - 1; index >= 0; index -= 1) {
			const row = this.grid[index] ?? [];
			if (row.some((cell) => cell !== null && cell !== "")) {
				return index + 1;
			}
		}
		return 0;
	}

	getLastColumn(): number {
		let width = 0;
		for (const row of this.grid)
			width = Math.max(width, row.length);
		return width;
	}

	getMaxColumns(): number {
		return this.maxColumns;
	}

	getDataRange(): GasRange {
		return this.getRange(
			1,
			1,
			Math.max(this.getLastRow(), 1),
			Math.max(this.getLastColumn(), 1),
		);
	}

	getRange(
		row: number,
		column: number,
		numRows: number,
		numColumns: number,
	): GasRange {
		if (row < 1 || column < 1) {
			throw new Error(
				"Sheets ranges are 1-based; got row " + row,
			);
		}
		const sheet = this;
		return {
			getValues(): CellValue[][] {
				const values: CellValue[][] = [];
				for (let r = 0; r < numRows; r += 1) {
					const source =
						sheet.grid[row - 1 + r] ?? [];
					const line: CellValue[] = [];
					for (
						let c = 0;
						c < numColumns;
						c += 1
					) {
						line.push(
							source[
								column - 1 + c
							] ?? "",
						);
					}
					values.push(line);
				}
				return values;
			},
			setValues(values: CellValue[][]): void {
				if (values.length !== numRows) {
					throw new Error(
						`setValues got ${values.length} rows for a ${numRows}-row range`,
					);
				}
				for (const line of values) {
					if (line.length !== numColumns) {
						throw new Error(
							`setValues got a ragged array: expected ${numColumns} columns, got ${line.length}`,
						);
					}
				}
				values.forEach((line, r) => {
					const target =
						sheet.grid[row - 1 + r] ?? [];
					line.forEach((cell, c) => {
						target[column - 1 + c] = cell;
					});
					sheet.grid[row - 1 + r] = target;
				});
			},
			clearContent(): void {
				for (let r = 0; r < numRows; r += 1) {
					const target = sheet.grid[row - 1 + r];
					if (!target) continue;
					for (
						let c = 0;
						c < numColumns;
						c += 1
					) {
						target[column - 1 + c] = "";
					}
				}
			},
		};
	}

	deleteRows(rowPosition: number, howMany: number): void {
		this.grid.splice(rowPosition - 1, howMany);
	}
}

export class FakeSpreadsheet implements GasSpreadsheet {
	readonly sheets = new Map<string, FakeSheet>();

	getSheetByName(name: string): GasSheet | null {
		return this.sheets.get(name) ?? null;
	}

	insertSheet(name: string): GasSheet {
		const sheet = new FakeSheet();
		this.sheets.set(name, sheet);
		return sheet;
	}
}

export class FakeSpreadsheetApp implements GasSpreadsheetApp {
	readonly opened: string[] = [];
	readonly spreadsheet = new FakeSpreadsheet();

	openById(id: string): GasSpreadsheet {
		this.opened.push(id);
		return this.spreadsheet;
	}
}

export class FakeUrlFetchApp implements GasUrlFetchApp {
	readonly calls: Array<{ url: string; options: GasFetchOptions }> = [];
	private readonly response: { status: number; body: string };

	constructor(response = { status: 200, body: "{}" }) {
		this.response = response;
	}

	fetch(url: string, options: GasFetchOptions): GasHttpResponse {
		this.calls.push({ url, options });
		const response = this.response;
		return {
			getResponseCode: () => response.status,
			getContentText: () => response.body,
		};
	}
}

export class FakeProperties implements GasProperties {
	readonly values = new Map<string, string>();
	getProperty(key: string): string | null {
		return this.values.get(key) ?? null;
	}
	setProperty(key: string, value: string): void {
		this.values.set(key, value);
	}
}

export class FakePropertiesService implements GasPropertiesService {
	readonly properties = new FakeProperties();
	acquisitions = 0;
	getScriptProperties(): GasProperties {
		this.acquisitions += 1;
		return this.properties;
	}
}

export class FakeCache implements GasCache {
	readonly values = new Map<string, { value: string; ttl: number }>();
	get(key: string): string | null {
		return this.values.get(key)?.value ?? null;
	}
	put(key: string, value: string, expirationInSeconds: number): void {
		this.values.set(key, { value, ttl: expirationInSeconds });
	}
}

export class FakeCacheService implements GasCacheService {
	readonly cache = new FakeCache();
	getScriptCache(): GasCache {
		return this.cache;
	}
}

export class FakeUtilities implements GasUtilities {
	readonly sleeps: number[] = [];
	private counter = 0;
	sleep(milliseconds: number): void {
		this.sleeps.push(milliseconds);
	}
	getUuid(): string {
		this.counter += 1;
		return `uuid-${this.counter}`;
	}
}

export class FakeGasLogger implements GasLogger {
	readonly lines: string[] = [];
	log(message: string): void {
		this.lines.push(message);
	}
}
