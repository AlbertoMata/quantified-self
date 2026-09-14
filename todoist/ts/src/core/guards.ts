// ─────────────────────────────────────────────────────────────────────────────
// The guards that replace a second Apps Script project
//
// The port develops inside the production project, against the production
// spreadsheet, with git as the safety net for the code (your decision,
// 2026-09-10). Git holds neither the spreadsheet nor the Script Properties, so
// the isolation a separate project used to provide has to come from somewhere
// else. It comes from two naming rules, enforced here:
//
//   * the port writes only tabs ending `_port`
//   * the port writes only state keys starting `PORT_`
//
// READS ARE UNRESTRICTED, and that asymmetry is the whole design. The port has
// to read what the legacy code wrote — HabitDaily is rebuilt from `Completions`
// and `RecurringStatus`, and the Completions cursor has to be read before it
// can be continued. Reading is harmless; writing is what cannot be undone.
//
// These are decorators rather than checks inside the GAS adapters on purpose: a
// guard baked into the only implementation cannot be tested apart from it, and
// the Node adapter (F2) needs exactly the same protection without a second copy.
// ─────────────────────────────────────────────────────────────────────────────

import type { KeyValueStore } from "../ports/key-value-store.ts";
import type { TableStore } from "../ports/table-store.ts";
import type { Row, TableName } from "../ports/values.ts";
import type { WritePlan } from "./write-plan.ts";

export const PORT_TAB_SUFFIX = "_port";
export const PORT_KEY_PREFIX = "PORT_";

export interface TableGuardOptions {
	// Let the port write tabs the legacy code owns. Exists for exactly one
	// moment — the E4 cutover, when the port takes over the real tabs — and
	// must be passed explicitly at the call site, never defaulted, never read
	// from config. A flag that can be switched on by a stale property is not a
	// guard.
	readonly allowProductionTabs?: boolean;
}

export interface StateGuardOptions {
	readonly allowProductionKeys?: boolean;
}

export function isPortTab(tab: TableName): boolean {
	return tab.endsWith(PORT_TAB_SUFFIX);
}

export function isPortKey(key: string): boolean {
	return key.startsWith(PORT_KEY_PREFIX);
}

function refuseTab(tab: TableName, operation: string): never {
	throw new Error(
		`Refusing to ${operation} "${tab}": the port may only write tabs ending ` +
			`"${PORT_TAB_SUFFIX}". Tabs without that suffix are owned by the legacy ` +
			`code and read by Looker Studio, and two of them — TaskDaily and ` +
			`AreaDaily — hold snapshot history that cannot be re-fetched from ` +
			`anywhere. Write "${tab}${PORT_TAB_SUFFIX}" instead. This guard comes ` +
			`off at E4, deliberately and once.`,
	);
}

function refuseKey(key: string): never {
	throw new Error(
		`Refusing to write the state key "${key}": the port may only write keys ` +
			`starting "${PORT_KEY_PREFIX}". Script Properties are shared with the ` +
			`running legacy sync, so advancing its cursor from here would make the ` +
			`nightly run skip that window and lose Completions rows — corruption in ` +
			`a tab the port never touched, invisible until someone spots the gap. ` +
			`Reading "${key}" is fine; write "${PORT_KEY_PREFIX}${key}" instead.`,
	);
}

// Wrap a TableStore so it can only write shadow tabs.
export function guardTableStore(
	tables: TableStore,
	options: TableGuardOptions = {},
): TableStore {
	const allowed = options.allowProductionTabs === true;
	const check = (tab: TableName, operation: string): void => {
		if (!allowed && !isPortTab(tab)) refuseTab(tab, operation);
	};

	return {
		// ── reads: unrestricted, by design ──
		readRows: (tab) => tables.readRows(tab),
		hasTable: (tab) => tables.hasTable(tab),

		// ── writes: shadow tabs only ──
		ensureTable(tab: TableName, header: Row): void {
			// Guarded even though it "only" creates: an ensureTable on a
			// mistyped legacy name would add a second, empty tab beside a real
			// one, which is its own kind of mess.
			check(tab, "create");
			tables.ensureTable(tab, header);
		},
		appendRows(tab: TableName, rows: readonly Row[]): void {
			check(tab, "append to");
			tables.appendRows(tab, rows);
		},
		writeRows(
			tab: TableName,
			firstRow: number,
			rows: readonly Row[],
		): void {
			check(tab, "write to");
			tables.writeRows(tab, firstRow, rows);
		},
		deleteRows(
			tab: TableName,
			firstRow: number,
			count: number,
		): void {
			check(tab, "delete rows from");
			tables.deleteRows(tab, firstRow, count);
		},
		clearRowsFrom(tab: TableName, firstRow: number): void {
			check(tab, "clear");
			tables.clearRowsFrom(tab, firstRow);
		},
	};
}

// Wrap a KeyValueStore so it can only write PORT_-prefixed keys.
export function guardKeyValueStore(
	state: KeyValueStore,
	options: StateGuardOptions = {},
): KeyValueStore {
	const allowed = options.allowProductionKeys === true;

	return {
		// Reading the legacy cursor is not merely permitted, it is required:
		// the port's first Completions run continues from where the legacy sync
		// has got to rather than starting from nothing.
		read: (key) => state.read(key),

		write(key: string, value: string): void {
			if (!allowed && !isPortKey(key)) refuseKey(key);
			state.write(key, value);
		},
	};
}

// Check a whole plan before any of it is carried out.
//
// WHY THIS EXISTS ALONGSIDE THE STORE GUARDS. The store guards fire when a
// write is actually attempted — which a DRY RUN never does. Without this, a
// dry run against `TaskDaily` would print a tidy list of operations and exit
// zero, telling you the plan was safe when running it for real would have been
// refused. A rail that only works when you are not looking is worse than none.
//
// So the applier calls this first, every time, dry run or not. Together the two
// layers are defence in depth: this one catches a bad plan, and the store
// guards catch anything that reaches a store without going through the applier.
export function assertPlanIsAllowed(
	plan: WritePlan,
	options: TableGuardOptions & StateGuardOptions = {},
): void {
	if (options.allowProductionTabs !== true) {
		for (const operation of plan.writes) {
			if (!isPortTab(operation.tab)) {
				refuseTab(
					operation.tab,
					`${operation.mode} to`,
				);
			}
		}
	}
	if (options.allowProductionKeys !== true) {
		for (const key of Object.keys(plan.stateToPersist)) {
			if (!isPortKey(key)) refuseKey(key);
		}
	}
}
