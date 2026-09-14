// ─────────────────────────────────────────────────────────────────────────────
// The Apps Script surface, described structurally
//
// Only the methods this project actually calls. That is a deliberate choice
// over @types/google-apps-script: it needs no dependency, it documents the
// blast radius of the platform in one readable file, and — the reason that
// matters most here — it makes every adapter injectable. An adapter takes the
// API as an argument rather than reaching for a global, so a test can hand it a
// fake and the GAS-only code below stays testable under plain Node.
//
// The globals themselves are named in exactly one place: gas-runtime.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { CellValue } from "../../ports/values.ts";

export interface GasRange {
	getValues(): CellValue[][];
	setValues(values: CellValue[][]): void;
	clearContent(): void;
}

export interface GasSheet {
	getLastRow(): number;
	getLastColumn(): number;
	getMaxColumns(): number;
	getDataRange(): GasRange;
	getRange(
		row: number,
		column: number,
		numRows: number,
		numColumns: number,
	): GasRange;
	deleteRows(rowPosition: number, howMany: number): void;
}

export interface GasSpreadsheet {
	getSheetByName(name: string): GasSheet | null;
	insertSheet(name: string): GasSheet;
}

export interface GasSpreadsheetApp {
	openById(id: string): GasSpreadsheet;
}

export interface GasHttpResponse {
	getResponseCode(): number;
	getContentText(): string;
}

// Only the request options the syncs use. `muteHttpExceptions` is the important
// one: without it UrlFetchApp throws on any non-2xx and the response body —
// which is where Todoist explains a 429 — is lost before anyone can read it.
export interface GasFetchOptions {
	method?: "get" | "post";
	contentType?: string;
	headers?: Record<string, string>;
	payload?: string;
	muteHttpExceptions?: boolean;
}

export interface GasUrlFetchApp {
	fetch(url: string, options: GasFetchOptions): GasHttpResponse;
}

export interface GasProperties {
	getProperty(key: string): string | null;
	setProperty(key: string, value: string): void;
}

export interface GasPropertiesService {
	getScriptProperties(): GasProperties;
}

export interface GasCache {
	get(key: string): string | null;
	put(key: string, value: string, expirationInSeconds: number): void;
}

export interface GasCacheService {
	getScriptCache(): GasCache;
}

export interface GasUtilities {
	sleep(milliseconds: number): void;
	getUuid(): string;
}

export interface GasLogger {
	log(message: string): void;
}
