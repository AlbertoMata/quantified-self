// ─────────────────────────────────────────────────────────────────────────────
// The layering test — what actually keeps this port portable
//
// The whole architecture rests on one sentence: a platform global may only be
// named inside `src/adapters/gas/`, and a Node built-in only inside
// `src/adapters/node/`. Sentences in design documents decay. This does not.
//
// It matters most a year from now, when someone (either of us) adds a quick
// SpreadsheetApp call to a pipeline because it is three lines and obviously
// fine. That is how the first port died, and it never announces itself.
//
// TWO TRAPS, both hit while writing this:
//
//   1. COMMENTS. Several files name a global while explaining what replaced it
//      — the port interfaces do it deliberately. A naive grep flags the
//      project's own documentation, and a test that fails on documentation gets
//      deleted by the first person it annoys.
//
//   2. `Logger`. Our own port is called Logger, which is also the name of the
//      Apps Script global. Matching the bare word flags `ports/logger.ts` and
//      everything importing it. The global has to be matched by USE — `Logger.`
//      followed by a call — rather than by name.
// ─────────────────────────────────────────────────────────────────────────────

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const sourceRoot = dirname(fileURLToPath(import.meta.url));

function everyTypeScriptFile(directory: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(directory)) {
		const path = join(directory, entry);
		if (statSync(path).isDirectory()) {
			found.push(...everyTypeScriptFile(path));
		} else if (entry.endsWith(".ts")) {
			found.push(path);
		}
	}
	return found;
}

// Remove comments and string/template literals, so only real code is examined.
//
// Deliberately simple rather than a parser: it handles the constructs this
// codebase actually contains. If it ever needs to understand regex literals or
// nested template expressions, that is a sign the test is being worked around.
function codeOnly(source: string): string {
	let result = "";
	let index = 0;
	let inLineComment = false;
	let inBlockComment = false;
	let quote: string | null = null;

	while (index < source.length) {
		const character = source[index] ?? "";
		const next = source[index + 1] ?? "";

		if (inLineComment) {
			if (character === "\n") {
				inLineComment = false;
				result += character;
			}
			index += 1;
		} else if (inBlockComment) {
			if (character === "*" && next === "/") {
				inBlockComment = false;
				index += 2;
			} else {
				index += 1;
			}
		} else if (quote) {
			if (character === "\\") {
				index += 2;
			} else {
				if (character === quote) quote = null;
				index += 1;
			}
		} else if (character === "/" && next === "/") {
			inLineComment = true;
			index += 2;
		} else if (character === "/" && next === "*") {
			inBlockComment = true;
			index += 2;
		} else if (
			character === '"' ||
			character === "'" ||
			character === "`"
		) {
			quote = character;
			index += 1;
		} else {
			result += character;
			index += 1;
		}
	}
	return result;
}

// Matched by USE, not by name — see trap 2 above. A bare `Logger` is our port;
// `Logger.log(...)` is Google's global.
const PLATFORM_GLOBALS = [
	"SpreadsheetApp",
	"UrlFetchApp",
	"PropertiesService",
	"CacheService",
	"Session",
	"Utilities",
	"Logger",
	"DriveApp",
	"ScriptApp",
	"HtmlService",
	"ContentService",
];

function platformGlobalUses(code: string): string[] {
	const found: string[] = [];
	for (const name of new Set(PLATFORM_GLOBALS)) {
		// `Name.` or `Name(` at a word boundary — a use, not a mention.
		const pattern = new RegExp(`\\b${name}\\s*[.(]`, "g");
		if (pattern.test(code)) found.push(name);
	}
	return found;
}

const sourceFiles = everyTypeScriptFile(sourceRoot).map((path) =>
	relative(sourceRoot, path),
);

test("the source tree is not empty, or this test proves nothing", () => {
	// A guard against the test quietly passing because the walk broke.
	assert.ok(
		sourceFiles.length > 20,
		`expected the port's source files, found ${sourceFiles.length}`,
	);
});

test("no Google global is used outside src/adapters/gas/", () => {
	const offenders: string[] = [];

	for (const file of sourceFiles) {
		if (file.startsWith(join("adapters", "gas"))) continue;
		const code = codeOnly(
			readFileSync(join(sourceRoot, file), "utf8"),
		);
		const used = platformGlobalUses(code);
		if (used.length > 0)
			offenders.push(`${file}: ${used.join(", ")}`);
	}

	assert.deepEqual(
		offenders,
		[],
		"A platform global escaped the adapter. Everything above ports/ must stay " +
			"runnable on a GitHub runner, which is the entire point of the seam — " +
			"put the call in src/adapters/gas/ and reach it through a port.",
	);
});

test("no Node built-in is imported outside src/adapters/node/ and tests", () => {
	// The mirror image, and just as important: `node:fs` in a pipeline would
	// break the Apps Script side, where there is no module system at all.
	// Tests are exempt — they legitimately use node:test and node:assert.
	const offenders: string[] = [];

	for (const file of sourceFiles) {
		if (file.endsWith(".test.ts")) continue;
		if (file.startsWith(join("adapters", "node"))) continue;
		const code = codeOnly(
			readFileSync(join(sourceRoot, file), "utf8"),
		);
		if (code.includes("node:")) offenders.push(file);
	}

	assert.deepEqual(
		offenders,
		[],
		"a Node built-in leaked above the adapter",
	);
});

test("core, services and pipelines import no adapter at all", () => {
	// The layering rule stated as a dependency direction rather than a word
	// list. core/ may not know that adapters exist; if it does, the "pure"
	// claim is already false whatever the globals say.
	const offenders: string[] = [];
	const pureLayers = ["core", "services", "pipelines"];

	for (const file of sourceFiles) {
		if (!pureLayers.some((layer) => file.startsWith(layer + "/")))
			continue;
		const code = codeOnly(
			readFileSync(join(sourceRoot, file), "utf8"),
		);
		if (code.includes("adapters/")) offenders.push(file);
	}

	assert.deepEqual(
		offenders,
		[],
		"a pure layer reached into an adapter — depend on a port instead",
	);
});

test("the check would actually catch a violation", () => {
	// A layering test that cannot fail is worse than none: it reports success
	// for ever while the thing it guards rots. So: prove the detector fires.
	const violation = "const sheet = SpreadsheetApp.openById(id);";
	assert.deepEqual(platformGlobalUses(codeOnly(violation)), [
		"SpreadsheetApp",
	]);

	// And prove it does NOT fire on the two traps.
	const inComment =
		"// SpreadsheetApp is reached through the TableStore port";
	assert.deepEqual(platformGlobalUses(codeOnly(inComment)), []);

	const inString = 'const name = "PropertiesService";';
	assert.deepEqual(platformGlobalUses(codeOnly(inString)), []);

	const ourPort =
		"import type { Logger } from './logger.ts';\nlet logger: Logger;";
	assert.deepEqual(
		platformGlobalUses(codeOnly(ourPort)),
		[],
		"our own Logger port must not be mistaken for Google's Logger global",
	);

	const theirLogger = "Logger.log('hello');";
	assert.deepEqual(platformGlobalUses(codeOnly(theirLogger)), ["Logger"]);
});
