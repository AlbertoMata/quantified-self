// Build the TypeScript port into ONE Apps Script file.
//
// WHY ONE FILE: clasp auth does not travel between machines, so pasting into
// the editor has to stay a practical fallback from anywhere. A bundle split
// across several files makes that ten select-all-pastes; one file makes it one.
// That was your requirement at A4 #3, and it is why the output is an IIFE
// rather than a set of modules.
//
// WHY A GENERATED FOOTER: Apps Script can only invoke GLOBAL functions, and an
// IIFE has no globals by definition. The footer declares one per registry
// entry, so adding an entry point is an edit to the registry and nothing else.
//
// ⚠️ EVERY GENERATED GLOBAL IS PREFIXED `port`. The bundle is pushed into the
// production project, where one flat global scope already holds syncTodoist,
// syncOverdue and nine more legacy names. A collision there is not an error —
// the last definition concatenated wins, silently, and the nightly trigger runs
// whichever that is. The prefix is what makes that impossible; it comes off at
// E4, here, in one line.

import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	dryRunGlobalNameFor,
	entryPoints,
	globalNameFor,
	hasDryRunVariant,
} from "../src/entrypoints/registry.ts";

const workspaceDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(workspaceDir, "..", "..");

// The bundle is staged into the SAME directory as the legacy .gs files, because
// `clasp push` replaces a project's entire contents — pushing a directory that
// held only the bundle would delete the ten files currently running the nightly
// sync. prepare-legacy.mjs stages those; this adds one file beside them.
const OUTPUT_DIR = join(workspaceDir, "dist", "sync");
const OUTPUT_FILE = "port-bundle.gs";

// A file name that sorts after every legacy one, so the bundle is concatenated
// last. Nothing currently depends on that — every top-level const in the legacy
// files is a self-contained literal — but it costs nothing to keep the new code
// downstream of the old.
const outputPath = join(OUTPUT_DIR, OUTPUT_FILE);

function buildFooter() {
	const lines = [
		"",
		"// ─────────────────────────────────────────────────────────────────",
		"// GENERATED — do not edit. Source: src/entrypoints/registry.ts",
		"//",
		"// Apps Script can only call globals, so one is declared per entry",
		"// point. The `port` prefix keeps these clear of the legacy globals",
		"// sharing this project's single flat scope. Removed at E4.",
		"// ─────────────────────────────────────────────────────────────────",
	];

	const seen = new Set();
	for (const entryPoint of entryPoints) {
		const globalName = globalNameFor(entryPoint);
		if (seen.has(globalName)) {
			throw new Error(
				`Two entry points generate the global "${globalName}". In one flat ` +
					`scope the last one silently wins — which is the bug this whole ` +
					`prefix scheme exists to prevent. Rename one of them.`,
			);
		}
		seen.add(globalName);

		const writes = entryPoint.writes?.length
			? ` · writes ${entryPoint.writes.join(", ")}`
			: "";
		lines.push(
			"",
			`// ${entryPoint.kind}${entryPoint.schedule ? ` · ${entryPoint.schedule}` : ""}${writes}`,
			`// ${entryPoint.summary}`,
			`function ${globalName}() {`,
			`\treturn ${GLOBAL_NAMESPACE}.invoke(${JSON.stringify(entryPoint.name)});`,
			"}",
		);

		// The dry-run twin. The editor's Run button takes no arguments, so the
		// only way to ask for a dry run from that dropdown is to give it its
		// own name — and having it sit directly beneath its real counterpart is
		// what makes reaching for it the easy option rather than the careful one.
		if (hasDryRunVariant(entryPoint)) {
			const dryRunName = dryRunGlobalNameFor(entryPoint);
			if (seen.has(dryRunName)) {
				throw new Error(
					`"${dryRunName}" is generated twice. Rename an entry point.`,
				);
			}
			seen.add(dryRunName);
			lines.push(
				"",
				`// DRY RUN of ${globalName} — logs every write it would make, performs none.`,
				`function ${dryRunName}() {`,
				`\treturn ${GLOBAL_NAMESPACE}.invoke(${JSON.stringify(entryPoint.name)}, true);`,
				"}",
			);
		}
	}
	return lines.join("\n") + "\n";
}

// The IIFE's return value is assigned to this, and the footer calls through it.
// A single underscore-prefixed name is the entire footprint the bundle leaves in
// the shared global scope besides the port* functions themselves.
const GLOBAL_NAMESPACE = "__quantifiedSelfPort";

mkdirSync(OUTPUT_DIR, { recursive: true });

const result = await build({
	entryPoints: [
		join(workspaceDir, "src", "entrypoints", "gas", "main.ts"),
	],
	bundle: true,
	format: "iife",
	globalName: GLOBAL_NAMESPACE,
	// ES2019 is what the Apps Script V8 runtime guarantees. Targeting anything
	// newer means a built-in that typechecks here and throws in the editor at
	// 23:30, which is precisely when nobody is looking.
	target: "es2019",
	platform: "neutral",
	// Readable on purpose. The editor is where this gets debugged, there is no
	// source map, and the whole bundle is a few tens of KB — minifying would
	// save nothing that matters and cost every future stack trace.
	minify: false,
	charset: "utf8",
	legalComments: "none",
	write: false,
});

const [output] = result.outputFiles ?? [];
if (!output) throw new Error("esbuild produced no output");

const banner = [
	"// GENERATED BUNDLE — do not edit in the Apps Script editor.",
	"//",
	"// Built from todoist/ts/src by `npm run build`. Any change made here is",
	"// lost on the next push, and the repo is the source of truth.",
	`// Entry points below are prefixed \`port\` until the E4 cutover.`,
	"",
].join("\n");

// ── Self-check: run the built artifact before it can reach the editor ────────
//
// Typechecking proves the SOURCE is sound; this proves the BUNDLE is. It
// evaluates the real output file in a sandbox with stand-ins for the Apps
// Script globals and calls every generated entry point. An ES2019 violation, a
// footer that names a function the IIFE never exported, or a runtime error on
// the very first line would all surface here — seconds after a build, instead
// of in the executions dashboard after a push.
function selfCheck(bundleSource) {
	const logLines = [];
	const sandbox = {
		// Only what portPing touches. Anything reaching further fails loudly,
		// which is the point: a smoke test that quietly no-ops proves nothing.
		PropertiesService: {
			getScriptProperties: () => ({
				getProperty: (key) =>
					key === "TODOIST_SPREADSHEET_ID"
						? "self-check-spreadsheet-id"
						: null,
				setProperty: () => {
					throw new Error(
						"self-check: nothing may write state",
					);
				},
			}),
		},
		SpreadsheetApp: {
			openById: () => {
				throw new Error(
					"self-check: nothing may open a spreadsheet",
				);
			},
		},
		UrlFetchApp: {
			fetch: () => {
				throw new Error(
					"self-check: nothing may make a network call",
				);
			},
		},
		CacheService: {
			getScriptCache: () => ({
				get: () => null,
				put: () => {},
			}),
		},
		Utilities: {
			sleep: () => {},
			getUuid: () => "self-check-uuid",
		},
		Logger: { log: (message) => logLines.push(String(message)) },
	};
	sandbox.globalThis = sandbox;

	const context = createContext(sandbox);
	runInContext(bundleSource, context, { filename: OUTPUT_FILE });

	for (const entryPoint of entryPoints) {
		const globalName = globalNameFor(entryPoint);
		if (typeof context[globalName] !== "function") {
			throw new Error(
				`Self-check failed: ${globalName}() is not a global in the built ` +
					`bundle. The footer and the IIFE disagree, so the editor would ` +
					`show the function and Apps Script would not find it.`,
			);
		}
	}

	// Every writing entry point must also expose its dry-run twin, or the only
	// safe way to try something in the editor would be missing exactly when it
	// is most wanted.
	for (const entryPoint of entryPoints.filter(hasDryRunVariant)) {
		const dryRunName = dryRunGlobalNameFor(entryPoint);
		if (typeof context[dryRunName] !== "function") {
			throw new Error(
				`Self-check failed: ${dryRunName}() is missing from the bundle.`,
			);
		}
	}

	// Only entry points that declare NO writes are safe to invoke here. Not
	// "diagnostics": portPingWrite is a diagnostic that writes, and invoking it
	// hit the sandbox's throwing SpreadsheetApp — the check doing its job.
	// Declaring `writes` is the honest signal; `kind` says how a thing is
	// invoked, not what it touches.
	//
	// A dry run is not safe here either: it still READS the tab to work out
	// what it would change, so it needs a real spreadsheet just the same.
	for (const entryPoint of entryPoints.filter(
		(e) => !hasDryRunVariant(e),
	)) {
		context[globalNameFor(entryPoint)]();
	}
	return logLines;
}

const bundleSource = banner + output.text + buildFooter();
const selfCheckLog = selfCheck(bundleSource);

const sizeKb = (Buffer.byteLength(bundleSource) / 1024).toFixed(1);
console.log(`\nBuilt ${outputPath.replace(repoRoot + "/", "")} (${sizeKb} KB)`);
console.log(`  ${entryPoints.length} entry point(s):`);
for (const entryPoint of entryPoints) {
	console.log(`    ${globalNameFor(entryPoint)}()  — ${entryPoint.kind}`);
}
console.log(`  self-check ran the bundle in a sandbox:`);
for (const line of selfCheckLog) console.log(`    ${line}`);

// Written only AFTER the self-check passes, so a broken bundle never sits in
// dist/ waiting for someone to push it.
writeFileSync(outputPath, bundleSource);
console.log("");
