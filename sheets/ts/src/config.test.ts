import { test } from "node:test";
import assert from "node:assert/strict";

import { readSetting, requireSetting } from "./config.ts";
import type { SettingLookup } from "./config.ts";

// A settings source backed by a plain object, standing in for Script Properties
// or process.env.
function lookupFrom(values: Record<string, string>): SettingLookup {
	return (key) => values[key];
}

test("requireSetting returns the value when it is set", () => {
	const lookup = lookupFrom({ TODOIST_SPREADSHEET_ID: "abc123" });
	assert.equal(
		requireSetting(lookup, "TODOIST_SPREADSHEET_ID"),
		"abc123",
	);
});

test("requireSetting trims surrounding whitespace", () => {
	// Pasting an ID out of a URL bar picks up a trailing newline more often
	// than anyone admits.
	const lookup = lookupFrom({ TODOIST_SPREADSHEET_ID: "  abc123\n" });
	assert.equal(
		requireSetting(lookup, "TODOIST_SPREADSHEET_ID"),
		"abc123",
	);
});

test("requireSetting throws when the key is absent", () => {
	const lookup = lookupFrom({});
	assert.throws(
		() => requireSetting(lookup, "TODOIST_SPREADSHEET_ID"),
		/Missing required setting "TODOIST_SPREADSHEET_ID"/,
	);
});

test("requireSetting throws when the value is blank rather than absent", () => {
	// A property that exists but holds "" is the shape a half-finished setup
	// leaves behind, and it must fail exactly like a missing one.
	for (const blankValue of ["", "   ", "\t\n"]) {
		const lookup = lookupFrom({
			TODOIST_SPREADSHEET_ID: blankValue,
		});
		assert.throws(
			() => requireSetting(lookup, "TODOIST_SPREADSHEET_ID"),
			/Missing required setting/,
		);
	}
});

test("requireSetting never invents a default", () => {
	// The whole point of the module: no code path returns a value the caller
	// did not put there.
	const lookup: SettingLookup = () => null;
	assert.throws(() => requireSetting(lookup, "ANY_KEY"));
});

test("readSetting falls back only when the value is missing or blank", () => {
	assert.equal(
		readSetting(
			lookupFrom({ TIMEZONE: "UTC" }),
			"TIMEZONE",
			"America/Mexico_City",
		),
		"UTC",
	);
	assert.equal(
		readSetting(lookupFrom({}), "TIMEZONE", "America/Mexico_City"),
		"America/Mexico_City",
	);
	assert.equal(
		readSetting(
			lookupFrom({ TIMEZONE: "  " }),
			"TIMEZONE",
			"America/Mexico_City",
		),
		"America/Mexico_City",
	);
});
