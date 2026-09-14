// Entry points run against fakes, with the guards in place — the same shape the
// editor gets, minus the platform.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
	FakePropertiesService,
	FakeSpreadsheetApp,
	FakeUtilities,
} from "../adapters/gas/fake-gas.ts";
import { createGasClock } from "../adapters/gas/gas-clock.ts";
import { createGasIdGenerator } from "../adapters/gas/gas-id-generator.ts";
import { createGasKeyValueStore } from "../adapters/gas/gas-key-value-store.ts";
import { createGasTableStore } from "../adapters/gas/gas-table-store.ts";
import { guardKeyValueStore, guardTableStore } from "../core/guards.ts";
import type { Runtime } from "../ports/index.ts";
import {
	dryRunGlobalNameFor,
	entryPoints,
	globalNameFor,
	hasDryRunVariant,
} from "./registry.ts";

function setUp() {
	const app = new FakeSpreadsheetApp();
	const properties = new FakePropertiesService();
	const lines: string[] = [];
	const runtime: Runtime = {
		http: {
			get: () => {
				throw new Error(
					"no entry point here may make a request",
				);
			},
			post: () => {
				throw new Error(
					"no entry point here may make a request",
				);
			},
		},
		// Guarded exactly as createGasRuntime guards them.
		tables: guardTableStore(createGasTableStore(app, "test-sheet")),
		state: guardKeyValueStore(createGasKeyValueStore(properties)),
		cache: { read: () => null, write: () => {} },
		clock: createGasClock(new FakeUtilities()),
		logger: { log: (message) => lines.push(message) },
		ids: createGasIdGenerator(new FakeUtilities()),
		settings: (key) =>
			({
				TODOIST_TOKEN: "fake-token",
				TODOIST_TIMEZONE: "America/Mexico_City",
			})[key] ?? null,
	};
	return { app, properties, lines, runtime };
}

function entryPointNamed(name: string) {
	const found = entryPoints.find((candidate) => candidate.name === name);
	assert.ok(found, `no entry point named ${name}`);
	return found;
}

test("a dry run writes no cell and persists no state", () => {
	const { app, properties, lines, runtime } = setUp();

	entryPointNamed("pingWrite").run(runtime, { dryRun: true });

	assert.equal(
		app.spreadsheet.sheets.size,
		0,
		"a dry run must not even create the tab",
	);
	assert.equal(
		properties.properties.values.size,
		0,
		"no state may be written",
	);
	assert.ok(lines.some((line) => line.includes("DRY RUN")));
	assert.ok(
		lines.some((line) => line.includes("append 1 row")),
		"it must still say what it would have done — that is the whole point",
	);
});

test("a real run writes the row and the state", () => {
	const { app, properties, runtime } = setUp();

	entryPointNamed("pingWrite").run(runtime, { dryRun: false });

	const sheet = app.spreadsheet.sheets.get("Ping_port");
	assert.ok(sheet, "the tab is created on first run");
	assert.deepEqual(sheet.grid[0], [
		"ran_at",
		"entry_point",
		"was_dry_run",
	]);
	assert.equal(sheet.getLastRow(), 2);
	assert.equal(
		properties.properties.getProperty("PORT_PING_LAST_RUN") !==
			null,
		true,
	);
});

test("a dry run followed by a real run produces exactly one row", () => {
	// The sequence someone will actually use: look first, then commit.
	const { app, runtime } = setUp();
	entryPointNamed("pingWrite").run(runtime, { dryRun: true });
	entryPointNamed("pingWrite").run(runtime, { dryRun: false });
	assert.equal(app.spreadsheet.sheets.get("Ping_port")?.getLastRow(), 2);
});

test("the writing entry point only ever touches a shadow tab and a PORT_ key", () => {
	// It runs with the guards on, so this passing is proof the guards permit it
	// — and the guard tests prove they would refuse anything else.
	const { runtime } = setUp();
	assert.doesNotThrow(() =>
		entryPointNamed("pingWrite").run(runtime, { dryRun: false }),
	);
});

test("every entry point that writes declares a dry-run twin", () => {
	// The build generates the twin from `writes`, so an entry point that
	// forgets to declare what it touches silently loses its dry run — the one
	// rail that costs nothing to leave on.
	for (const entryPoint of entryPoints) {
		if (entryPoint.writes?.length) {
			assert.equal(hasDryRunVariant(entryPoint), true);
			assert.match(
				dryRunGlobalNameFor(entryPoint),
				/DryRun$/,
			);
		}
	}
});

test("a dry-run global never collides with a real one", () => {
	const names = new Set<string>();
	for (const entryPoint of entryPoints) {
		for (const name of [
			globalNameFor(entryPoint),
			...(hasDryRunVariant(entryPoint)
				? [dryRunGlobalNameFor(entryPoint)]
				: []),
		]) {
			assert.equal(
				names.has(name),
				false,
				`${name} generated twice`,
			);
			names.add(name);
		}
	}
});
