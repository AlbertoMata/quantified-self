// The rails that replace a second Apps Script project.
//
// These tests are the specification of what the port is allowed to touch while
// it shares a project and a spreadsheet with the running legacy sync. If one of
// them starts failing, something has been given permission to write production.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { KeyValueStore } from "../ports/key-value-store.ts";
import type { TableStore } from "../ports/table-store.ts";
import type { Row, TableName } from "../ports/values.ts";
import { applyWritePlan } from "./apply-write-plan.ts";
import {
	guardKeyValueStore,
	guardTableStore,
	isPortKey,
	isPortTab,
} from "./guards.ts";
import { appendTo, replaceWhere } from "./write-plan.ts";

// Records every call that got through the guard.
function recordingTables() {
	const calls: string[] = [];
	const store: TableStore = {
		readRows: (tab) => {
			calls.push(`read ${tab}`);
			return [];
		},
		hasTable: (tab) => {
			calls.push(`has ${tab}`);
			return true;
		},
		ensureTable: (tab) =>
			calls.push(`ensure ${tab}`) as unknown as void,
		appendRows: (tab) =>
			calls.push(`append ${tab}`) as unknown as void,
		writeRows: (tab) =>
			calls.push(`write ${tab}`) as unknown as void,
		deleteRows: (tab) =>
			calls.push(`delete ${tab}`) as unknown as void,
		clearRowsFrom: (tab) =>
			calls.push(`clear ${tab}`) as unknown as void,
	};
	return { calls, store };
}

function recordingState() {
	const writes: string[] = [];
	const store: KeyValueStore = {
		read: () => null,
		write: (key) => writes.push(key) as unknown as void,
	};
	return { writes, store };
}

// ── the tab-name guard ───────────────────────────────────────────────────────

test("writing a tab the legacy code owns is refused", () => {
	const { calls, store } = recordingTables();
	const guarded = guardTableStore(store);
	const row: Row = ["2026-09-14"];

	for (const attempt of [
		() => guarded.appendRows("Overdue", [row]),
		() => guarded.writeRows("Overdue", 2, [row]),
		() => guarded.clearRowsFrom("Overdue", 2),
		() => guarded.deleteRows("Overdue", 2, 1),
		() => guarded.ensureTable("Overdue", row),
	]) {
		assert.throws(attempt, /may only write tabs ending "_port"/);
	}
	assert.deepEqual(calls, [], "nothing may reach the real store");
});

test("writing a shadow tab succeeds", () => {
	const { calls, store } = recordingTables();
	const guarded = guardTableStore(store);
	guarded.ensureTable("Overdue_port", ["day"]);
	guarded.appendRows("Overdue_port", [["2026-09-14"]]);
	guarded.writeRows("Overdue_port", 2, [["2026-09-14"]]);
	guarded.clearRowsFrom("Overdue_port", 2);
	assert.deepEqual(calls, [
		"ensure Overdue_port",
		"append Overdue_port",
		"write Overdue_port",
		"clear Overdue_port",
	]);
});

test("reading a production tab is allowed, and has to be", () => {
	// HabitDaily is rebuilt from Completions and RecurringStatus. A guard that
	// blocked reads would make the port unable to do its job at all.
	const { calls, store } = recordingTables();
	const guarded = guardTableStore(store);
	guarded.readRows("Completions");
	guarded.hasTable("RecurringStatus");
	assert.deepEqual(calls, ["read Completions", "has RecurringStatus"]);
});

test("the escape hatch exists but must be asked for explicitly", () => {
	// E4 is the one moment this is correct.
	const { calls, store } = recordingTables();
	const guarded = guardTableStore(store, { allowProductionTabs: true });
	guarded.appendRows("Overdue", [["2026-09-14"]]);
	assert.deepEqual(calls, ["append Overdue"]);
});

test("a truthy-but-not-true flag does not open the gate", () => {
	// A config value arriving as the string "false" — or anything else that is
	// merely truthy — must not disable the only protection there is.
	const { store } = recordingTables();
	const guarded = guardTableStore(store, {
		allowProductionTabs: "yes" as unknown as boolean,
	});
	assert.throws(() => guarded.appendRows("Overdue", [["x"]]));
});

test("a tab merely containing _port is not a shadow tab", () => {
	const { store } = recordingTables();
	const guarded = guardTableStore(store);
	assert.throws(() => guarded.appendRows("_port_backup", [["x"]]));
	assert.equal(isPortTab("Overdue_port"), true);
	assert.equal(
		isPortTab("Overdue_PORT"),
		false,
		"the suffix is case-sensitive",
	);
});

// ── the state-key guard ──────────────────────────────────────────────────────

test("advancing the legacy cursor is refused", () => {
	// The sharpest edge in the whole port: Script Properties are shared with
	// the running sync, so this would make the nightly run skip a window and
	// lose Completions rows — in a tab the port never wrote.
	const { writes, store } = recordingState();
	const guarded = guardKeyValueStore(store);
	assert.throws(
		() =>
			guarded.write(
				"TODOIST_LAST_SYNC",
				"2026-09-14T05:30:00Z",
			),
		/may only write keys starting "PORT_"/,
	);
	assert.throws(() => guarded.write("TODOIST_IN_REVIEW_PREV", "[]"));
	assert.deepEqual(writes, []);
});

test("writing a PORT_ key succeeds", () => {
	const { writes, store } = recordingState();
	guardKeyValueStore(store).write(
		"PORT_TODOIST_LAST_SYNC",
		"2026-09-14T05:30:00Z",
	);
	assert.deepEqual(writes, ["PORT_TODOIST_LAST_SYNC"]);
});

test("reading the legacy cursor is allowed, and has to be", () => {
	// The port's first Completions run continues from where the legacy sync
	// has reached rather than starting from nothing.
	const reads: string[] = [];
	const guarded = guardKeyValueStore({
		read: (key) => {
			reads.push(key);
			return "2026-09-13T05:30:00Z";
		},
		write: () => {},
	});
	assert.equal(guarded.read("TODOIST_LAST_SYNC"), "2026-09-13T05:30:00Z");
	assert.deepEqual(reads, ["TODOIST_LAST_SYNC"]);
});

test("the prefix is case-sensitive", () => {
	const { store } = recordingState();
	const guarded = guardKeyValueStore(store);
	assert.throws(() => guarded.write("port_cursor", "x"));
	assert.equal(isPortKey("PORT_X"), true);
	assert.equal(isPortKey("port_X"), false);
});

// ── the guards under a real plan ─────────────────────────────────────────────

test("a plan aimed at a production tab is stopped before a single cell moves", () => {
	// The realistic accident: a pipeline built with the legacy tab name.
	const { calls, store } = recordingTables();
	const { writes, store: state } = recordingState();

	assert.throws(
		() =>
			applyWritePlan(
				{
					writes: [
						appendTo("Completions", [
							["2026-09-14"],
						]),
					],
					stateToPersist: { PORT_CURSOR: "x" },
					logLines: [],
				},
				guardTableStore(store),
				guardKeyValueStore(state),
				{ log: () => {} },
			),
		/may only write tabs ending "_port"/,
	);
	assert.deepEqual(
		calls,
		[],
		"the plan is validated up front, so not even a read is issued",
	);
	assert.deepEqual(
		writes,
		[],
		"state must not be persisted after a failed write",
	);
});

test("a dry run is refused too, so the guard is never bypassed by inspection", () => {
	// The store guards alone could not do this: a dry run never attempts a
	// write, so nothing would fire, and the run would print a tidy list of
	// operations and exit zero — teaching you the plan was safe when running it
	// for real would have been refused. Hence the up-front plan check.
	const { store } = recordingTables();
	const { store: state } = recordingState();
	assert.throws(
		() =>
			applyWritePlan(
				{
					writes: [
						replaceWhere(
							"TaskDaily",
							0,
							{ all: true },
							[["2026-09-14"]],
						),
					],
					stateToPersist: {},
					logLines: [],
				},
				guardTableStore(store),
				guardKeyValueStore(state),
				{ log: () => {} },
				{ dryRun: true },
			),
		/may only write tabs ending "_port"/,
	);
});

test("a correct plan passes both guards untouched", () => {
	const { calls, store } = recordingTables();
	const { writes, store: state } = recordingState();

	applyWritePlan(
		{
			writes: [
				appendTo("Completions_port", [["2026-09-14"]]),
			],
			stateToPersist: {
				PORT_TODOIST_LAST_SYNC: "2026-09-14T05:30:00Z",
			},
			logLines: [],
		},
		guardTableStore(store),
		guardKeyValueStore(state),
		{ log: () => {} },
	);

	assert.deepEqual(calls, [
		"read Completions_port",
		"append Completions_port",
	]);
	assert.deepEqual(writes, ["PORT_TODOIST_LAST_SYNC"]);
});
