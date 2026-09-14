// ─────────────────────────────────────────────────────────────────────────────
// WritePlan — what a pipeline returns instead of writing
//
// Every pipeline is a pure function from an in-memory snapshot to one of these.
// Nothing here performs I/O; applying a plan is a separate, dumb step. Three
// things follow from that, and they are the reason the shape exists:
//
//   1. A pipeline can be tested by asserting on the plan it produced, with no
//      sheet, no network and no clock.
//   2. Dry-run (B4c) is free — log the plan instead of applying it.
//   3. The 6-minute execution cap becomes survivable. Because the whole plan is
//      known before the first cell is touched, a time budget can stop BETWEEN
//      operations rather than in the middle of one. That is the difference
//      between a partial run and a corrupt tab.
//
// EIGHT STRATEGIES, THREE VERBS. The tab-strategy table in todoist/README.md
// lists eight hand-rolled write strategies. They collapse to three:
//
//   append        Completions
//   replaceWhere  Overdue, RecurringStatus, AreaDaily, TaskDaily (equals today)
//                 HabitDaily (onOrAfter a cutoff — a trailing window)
//                 BillCycle  (all — a full rebuild)
//   upsert        KarmaStats (by date)
// ─────────────────────────────────────────────────────────────────────────────

import type { Row, TableName } from "../ports/values.ts";
import { cellAsText } from "./row.ts";

// Which existing rows a replaceWhere is allowed to remove.
//
// `all` was not in the original design and the plan's Match had only the first
// two. BillCycle is a **full rebuild** — every data row is recomputed from
// Completions plus the live task list every night — and no key-based predicate
// expresses "all of them". Leaving it out would have forced BillCycle back into
// a hand-rolled fourth strategy, which is exactly what this type exists to stop.
export type Match =
	| { readonly equals: string }
	| { readonly onOrAfter: string }
	| { readonly all: true };

export type WriteOperation =
	// Add rows at the end, touching nothing that is already there. The only
	// verb Completions may ever use: its rows are history that cannot be
	// re-fetched once Todoist's activity log ages out.
	| {
			readonly mode: "append";
			readonly tab: TableName;
			readonly rows: readonly Row[];
	  }
	// Remove the rows matching `match` on column `columnIndex`, then write
	// `rows` in their place.
	| {
			readonly mode: "replaceWhere";
			readonly tab: TableName;
			readonly columnIndex: number;
			readonly match: Match;
			readonly rows: readonly Row[];
	  }
	// Replace rows whose key column already exists, append the rest. Order is
	// preserved: an updated row stays where it was.
	| {
			readonly mode: "upsert";
			readonly tab: TableName;
			readonly keyColumnIndex: number;
			readonly rows: readonly Row[];
	  };

export interface WritePlan {
	readonly writes: readonly WriteOperation[];

	// Written only AFTER every write above has landed.
	//
	// This ordering is the whole reason state is a separate field rather than
	// just another write. TODOIST_LAST_SYNC advanced before its rows are in is
	// a cursor that has skipped them — and with no locking and a 6-minute cap,
	// a run dying between the two is a real event, not a thought experiment.
	// Rows without a cursor bump are re-fetched and deduped; a cursor bump
	// without rows is a permanent hole.
	readonly stateToPersist: Readonly<Record<string, string>>;

	readonly logLines: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolving a plan into concrete mutations
//
// Pure: it takes the rows a tab currently holds and returns what to do about
// them. The applier then performs these against a TableStore and nothing else.
// Splitting it this way is what lets every verb be tested exhaustively against
// plain arrays.
// ─────────────────────────────────────────────────────────────────────────────

// Sheet rows are 1-based and row 1 is the header, so data starts at row 2.
const FIRST_DATA_ROW = 2;

export type TableMutation =
	// Blank from this 1-based row to the end of the tab. NOT a deletion: Sheets
	// refuses to delete every unfrozen row once the header is frozen — see
	// TableStore.clearRowsFrom.
	| { readonly kind: "clearFrom"; readonly firstRow: number }
	| {
			readonly kind: "write";
			readonly firstRow: number;
			readonly rows: readonly Row[];
	  }
	| { readonly kind: "append"; readonly rows: readonly Row[] };

function matches(match: Match, value: string): boolean {
	if ("all" in match) return true;
	if ("equals" in match) return value === match.equals;
	// String comparison is deliberate and safe here because every key this is
	// used with is an ISO day (YYYY-MM-DD), which sorts lexicographically the
	// same way it sorts chronologically. C1 owns producing those keys.
	return value >= match.onOrAfter;
}

// Given a tab's current contents (header included) and one operation, work out
// the mutations that carry it out.
export function resolveWriteOperation(
	currentRows: readonly Row[],
	operation: WriteOperation,
): TableMutation[] {
	const dataRows = currentRows.slice(1);

	if (operation.mode === "append") {
		return operation.rows.length === 0
			? []
			: [{ kind: "append", rows: operation.rows }];
	}

	if (operation.mode === "replaceWhere") {
		const firstMatchOffset = dataRows.findIndex((row) =>
			matches(
				operation.match,
				cellAsText(row, operation.columnIndex),
			),
		);

		// Nothing to replace — this is the ordinary first-run-of-the-day case,
		// so it appends rather than erroring.
		if (firstMatchOffset === -1) {
			return operation.rows.length === 0
				? []
				: [{ kind: "append", rows: operation.rows }];
		}

		// The rows being replaced must be a contiguous TAIL. Every tab this
		// runs against is appended in day order, so "today's rows" and "the
		// last N days" are always at the bottom — the legacy code relies on
		// exactly this ("Rows are appended in date order, so everything from
		// the first in-window row down is in the window").
		//
		// If that assumption is false, the tab has been sorted or edited by
		// hand, and clearing to the end would destroy rows nobody asked to
		// touch. Refuse instead. This is the one place a wrong guess is
		// unrecoverable for TaskDaily and AreaDaily.
		const strandedOffset = dataRows.findIndex(
			(row, offset) =>
				offset > firstMatchOffset &&
				!matches(
					operation.match,
					cellAsText(row, operation.columnIndex),
				),
		);
		if (strandedOffset !== -1) {
			throw new Error(
				`replaceWhere on "${operation.tab}" would clear row ` +
					`${strandedOffset + FIRST_DATA_ROW}, which does not match. ` +
					`Rows matching the predicate must form a contiguous block at the ` +
					`bottom of the tab; they do not, so the tab has been reordered or ` +
					`edited by hand. Refusing rather than clearing to the end.`,
			);
		}

		const firstRow = firstMatchOffset + FIRST_DATA_ROW;
		const mutations: TableMutation[] = [
			{ kind: "clearFrom", firstRow },
		];
		if (operation.rows.length > 0) {
			// Clearing leaves the (blank) rows in place, so the rewrite lands
			// straight back on top of them at the same row.
			mutations.push({
				kind: "write",
				firstRow,
				rows: operation.rows,
			});
		}
		return mutations;
	}

	// upsert — replace in place where the key already exists, append the rest.
	const rowOffsetByKey = new Map<string, number>();
	dataRows.forEach((row, offset) => {
		const key = cellAsText(row, operation.keyColumnIndex);
		// First occurrence wins, so a tab that already holds a duplicate key is
		// repaired downward rather than having both copies updated.
		if (key !== "" && !rowOffsetByKey.has(key)) {
			rowOffsetByKey.set(key, offset);
		}
	});

	const mutations: TableMutation[] = [];
	const toAppend: Row[] = [];
	for (const row of operation.rows) {
		const key = cellAsText(row, operation.keyColumnIndex);
		const existingOffset = rowOffsetByKey.get(key);
		if (existingOffset === undefined) {
			toAppend.push(row);
		} else {
			mutations.push({
				kind: "write",
				firstRow: existingOffset + FIRST_DATA_ROW,
				rows: [row],
			});
		}
	}
	if (toAppend.length > 0)
		mutations.push({ kind: "append", rows: toAppend });
	return mutations;
}

// Convenience builders. They exist so a pipeline reads as a list of intentions
// rather than a pile of object literals, and so the `mode` strings are written
// once rather than at every call site.
export function appendTo(tab: TableName, rows: readonly Row[]): WriteOperation {
	return { mode: "append", tab, rows };
}

export function replaceWhere(
	tab: TableName,
	columnIndex: number,
	match: Match,
	rows: readonly Row[],
): WriteOperation {
	return { mode: "replaceWhere", tab, columnIndex, match, rows };
}

export function upsertBy(
	tab: TableName,
	keyColumnIndex: number,
	rows: readonly Row[],
): WriteOperation {
	return { mode: "upsert", tab, keyColumnIndex, rows };
}

export function emptyPlan(): WritePlan {
	return { writes: [], stateToPersist: {}, logLines: [] };
}
