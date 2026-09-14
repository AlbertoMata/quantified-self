// ─────────────────────────────────────────────────────────────────────────────
// Where the Google globals are actually named — and the ONLY such place
//
// Every adapter beside this one takes its API as an argument, so all of them
// are testable under plain Node with a fake. This file is the single point at
// which the real platform is reached, which keeps the untestable surface of the
// whole project down to the handful of lookups below.
//
// They are read off globalThis rather than declared ambiently on purpose. Under
// Node they are simply undefined, so createGasRuntime() fails immediately and
// legibly instead of throwing "SpreadsheetApp is not defined" from somewhere
// deep inside a pipeline — and the check costs one comparison per run.
// ─────────────────────────────────────────────────────────────────────────────

import { guardKeyValueStore, guardTableStore } from "../../core/guards.ts";
import type { Runtime } from "../../ports/index.ts";
import { withRetry } from "../../services/retry-transport.ts";
import { createGasCacheStore } from "./gas-cache-store.ts";
import { createGasClock } from "./gas-clock.ts";
import { createGasHttpTransport } from "./gas-http.ts";
import { createGasIdGenerator } from "./gas-id-generator.ts";
import { createGasKeyValueStore } from "./gas-key-value-store.ts";
import { createGasLogger } from "./gas-logger.ts";
import { createGasTableStore } from "./gas-table-store.ts";
import type {
	GasCacheService,
	GasLogger,
	GasPropertiesService,
	GasSpreadsheetApp,
	GasUrlFetchApp,
	GasUtilities,
} from "./gas-types.ts";

interface AppsScriptGlobals {
	SpreadsheetApp?: GasSpreadsheetApp;
	UrlFetchApp?: GasUrlFetchApp;
	PropertiesService?: GasPropertiesService;
	CacheService?: GasCacheService;
	Utilities?: GasUtilities;
	Logger?: GasLogger;
}

function requireGlobal<Key extends keyof AppsScriptGlobals>(
	name: Key,
): NonNullable<AppsScriptGlobals[Key]> {
	const globals = globalThis as unknown as AppsScriptGlobals;
	const value = globals[name];
	if (!value) {
		throw new Error(
			`${String(name)} is not available. This runtime is for Apps Script ` +
				`only — under Node use createNodeRuntime() instead.`,
		);
	}
	return value as NonNullable<AppsScriptGlobals[Key]>;
}

export interface GasRuntimeOptions {
	// Drop the B4b guards. There is exactly one moment this is correct — the
	// E4 cutover, when the port takes over the real tabs and state keys — and
	// it must be passed at the call site rather than read from config, because
	// a rail a stale Script Property can switch off is not a rail.
	readonly allowProductionWrites?: boolean;
}

// Build every port over the live Apps Script platform.
//
// The spreadsheet id is a required argument with no default, deliberately. A
// default that resolved to production is how a test run becomes an incident,
// and two of the tabs it could damage hold history that cannot be re-fetched
// from anywhere. config.ts enforces the same rule one level up.
//
// The B4b guards are ON unless explicitly disabled. They are the entire
// protection the port has in place of a separate project, so they have to be
// something you opt OUT of, never something you remember to opt in to.
export function createGasRuntime(
	spreadsheetId: string,
	options: GasRuntimeOptions = {},
): Runtime {
	if (!spreadsheetId || spreadsheetId.trim() === "") {
		throw new Error(
			"createGasRuntime() needs a spreadsheet id. Nothing defaults to a " +
				"live spreadsheet on purpose — read it from Script Properties.",
		);
	}

	const utilities = requireGlobal("Utilities");
	const unguarded = options.allowProductionWrites === true;
	const clock = createGasClock(utilities);
	const logger = createGasLogger(requireGlobal("Logger"));

	return {
		// Retry is applied HERE rather than inside the adapter, so the adapter
		// stays a thin translation of UrlFetchApp and the policy stays testable
		// under plain Node. The Node transport is deliberately NOT wrapped: it
		// is still the F2 stub, and retrying `notImplemented` three times would
		// turn a clear error into a slow one.
		http: withRetry(
			createGasHttpTransport(requireGlobal("UrlFetchApp")),
			{ clock, logger },
		),
		tables: guardTableStore(
			createGasTableStore(
				requireGlobal("SpreadsheetApp"),
				spreadsheetId.trim(),
			),
			{ allowProductionTabs: unguarded },
		),
		state: guardKeyValueStore(
			createGasKeyValueStore(
				requireGlobal("PropertiesService"),
			),
			{ allowProductionKeys: unguarded },
		),
		cache: createGasCacheStore(requireGlobal("CacheService")),
		clock,
		logger,
		ids: createGasIdGenerator(utilities),
		settings: createGasSettingLookup(),
	};
}

// A settings lookup over Script Properties, for reading config BEFORE a runtime
// exists — the spreadsheet id among them, which createGasRuntime() needs as an
// argument. Without this the entry-point module would have to name
// PropertiesService itself, putting a Google global outside adapters/gas/ and
// breaking the one rule the B6 test enforces.
export function createGasSettingLookup(): (key: string) => string | null {
	const properties =
		requireGlobal("PropertiesService").getScriptProperties();
	return (key: string) => properties.getProperty(key);
}
