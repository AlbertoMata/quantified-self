import assert from "node:assert/strict";
import { test } from "node:test";

import type { KeyValueStore } from "../ports/key-value-store.ts";
import type { Logger } from "../ports/logger.ts";
import type { TableStore } from "../ports/table-store.ts";
import type { Row, TableName } from "../ports/values.ts";
import { applyWritePlan } from "./apply-write-plan.ts";
import { appendTo, replaceWhere, type WritePlan } from "./write-plan.ts";

class RecordingTableStore implements TableStore {
	readonly tabs = new Map<TableName, Row[]>();
	readonly calls: string[] = [];

	readRows(tab: TableName): Row[] {
		return [...(this.tabs.get(tab) ?? [])];
	}
	hasTable(tab: TableName): boolean {
		return this.tabs.has(tab);
	}
	ensureTable(tab: TableName, header: Row): void {
		if (!this.tabs.has(tab)) this.tabs.set(tab, [header]);
	}
	appendRows(tab: TableName, rows: readonly Row[]): void {
		this.calls.push(`append ${tab} ${rows.length}`);
		this.tabs.set(tab, [...(this.tabs.get(tab) ?? []), ...rows]);
	}
	writeRows(
		tab: TableName,
		firstRow: number,
		rows: readonly Row[],
	): void {
		this.calls.push(`write ${tab} @${firstRow} ${rows.length}`);
		const existing = [...(this.tabs.get(tab) ?? [])];
		rows.forEach((row, offset) => {
			existing[firstRow - 1 + offset] = row;
		});
		this.tabs.set(tab, existing);
	}
	deleteRows(): void {
		throw new Error("the applier must never delete rows");
	}
	clearRowsFrom(tab: TableName, firstRow: number): void {
		this.calls.push(`clear ${tab} @${firstRow}`);
		this.tabs.set(
			tab,
			[...(this.tabs.get(tab) ?? [])].slice(0, firstRow - 1),
		);
	}
}

class RecordingState implements KeyValueStore {
	readonly values = new Map<string, string>();
	readonly order: string[] = [];
	read(key: string): string | null {
		return this.values.get(key) ?? null;
	}
	write(key: string, value: string): void {
		this.order.push(key);
		this.values.set(key, value);
	}
}

class CollectingLogger implements Logger {
	readonly lines: string[] = [];
	log(message: string): void {
		this.lines.push(message);
	}
}

const HEADER: Row = ["day", "value"];

function setUp() {
	const tables = new RecordingTableStore();
	tables.ensureTable("Overdue_port", HEADER);
	tables.appendRows("Overdue_port", [["2026-09-13", 1]]);
	tables.calls.length = 0; // ignore the fixture's own calls
	return {
		tables,
		state: new RecordingState(),
		logger: new CollectingLogger(),
	};
}

test("state is persisted only after every row has landed", () => {
	// The ordering the whole WritePlan shape exists to guarantee. A cursor
	// advanced before its rows is a permanent gap in Completions.
	const { tables, state, logger } = setUp();
	const plan: WritePlan = {
		writes: [appendTo("Overdue_port", [["2026-09-14", 2]])],
		stateToPersist: {
			PORT_TODOIST_LAST_SYNC: "2026-09-14T05:30:00Z",
		},
		logLines: [],
	};

	applyWritePlan(plan, tables, state, logger);

	assert.deepEqual(tables.calls, ["append Overdue_port 1"]);
	assert.equal(
		state.read("PORT_TODOIST_LAST_SYNC"),
		"2026-09-14T05:30:00Z",
	);
	const stateLogIndex = logger.lines.findIndex((line) =>
		line.startsWith("state:"),
	);
	const writeLogIndex = logger.lines.findIndex((line) =>
		line.includes("append"),
	);
	assert.ok(
		writeLogIndex < stateLogIndex,
		"the write must be logged before the state it authorises",
	);
});

test("dry run performs nothing at all but reports everything", () => {
	const { tables, state, logger } = setUp();
	const plan: WritePlan = {
		writes: [
			replaceWhere("Overdue_port", 0, { all: true }, [
				["2026-09-14", 2],
			]),
		],
		stateToPersist: { PORT_CURSOR: "x" },
		logLines: [],
	};

	applyWritePlan(plan, tables, state, logger, { dryRun: true });

	assert.deepEqual(tables.calls, [], "no mutation may reach the store");
	assert.equal(
		state.read("PORT_CURSOR"),
		null,
		"no state may be written",
	);
	assert.ok(logger.lines.some((line) => line.includes("DRY RUN")));
	assert.ok(
		logger.lines.some((line) => line.includes("clear")),
		"a dry run must still say what it would have done",
	);
});

test("each operation is resolved against a freshly read tab", () => {
	// Two operations on the same tab: the second must see the first's rows, or
	// its row numbers are stale before they are used.
	const { tables, state, logger } = setUp();
	const plan: WritePlan = {
		writes: [
			appendTo("Overdue_port", [["2026-09-14", 2]]),
			replaceWhere(
				"Overdue_port",
				0,
				{ equals: "2026-09-14" },
				[["2026-09-14", 99]],
			),
		],
		stateToPersist: {},
		logLines: [],
	};

	applyWritePlan(plan, tables, state, logger);

	assert.deepEqual(tables.readRows("Overdue_port"), [
		HEADER,
		["2026-09-13", 1],
		["2026-09-14", 99],
	]);
});

test("plan log lines reach the logger", () => {
	const { tables, state, logger } = setUp();
	applyWritePlan(
		{
			writes: [],
			stateToPersist: {},
			logLines: ["Completions: 14 new, 3 duplicates skipped"],
		},
		tables,
		state,
		logger,
	);
	assert.ok(
		logger.lines.includes(
			"Completions: 14 new, 3 duplicates skipped",
		),
	);
});
