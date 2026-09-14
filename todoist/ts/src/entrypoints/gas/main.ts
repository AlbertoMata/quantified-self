// ─────────────────────────────────────────────────────────────────────────────
// The bundle's entry module — everything the Apps Script editor can reach
//
// esbuild bundles this into a single IIFE and the build appends a footer that
// exposes one global per registry entry, each one calling `invoke()` below.
// That indirection is what keeps the whole surface in a list rather than in
// eleven hand-written wrappers.
// ─────────────────────────────────────────────────────────────────────────────

import {
	createGasRuntime,
	createGasSettingLookup,
} from "../../adapters/gas/gas-runtime.ts";
import { requireSetting } from "../../config.ts";
import type { Runtime } from "../../ports/index.ts";
import { entryPoints } from "../registry.ts";

// The Script Property holding the target spreadsheet. Read through
// requireSetting so a missing value throws with an explanation rather than
// resolving to undefined and failing somewhere deeper.
const SPREADSHEET_ID_KEY = "TODOIST_SPREADSHEET_ID";

// Built once per execution, not per entry point: an Apps Script run invokes
// exactly one of these.
//
// Note what this does NOT do: name a Google global. The settings lookup comes
// from adapters/gas/, so this module stays free of the platform and the B6
// layering rule holds — `src/adapters/gas/` really is the only place.
function createRuntime(): Runtime {
	const spreadsheetId = requireSetting(
		createGasSettingLookup(),
		SPREADSHEET_ID_KEY,
	);
	return createGasRuntime(spreadsheetId);
}

// Called by every generated global. Kept tiny and boring: a failure here would
// be a failure of all of them at once.
//
// `dryRun` arrives from the footer rather than from config, because the editor's
// Run button cannot pass an argument and a dry-run flag read from a Script
// Property would be a dry run you could forget to turn back off — or worse,
// forget was on, and believe a run had happened when it had not.
export function invoke(name: string, dryRun = false): void {
	const entryPoint = entryPoints.find(
		(candidate) => candidate.name === name,
	);
	if (!entryPoint) {
		// Only reachable if the footer and the registry disagree, which would
		// mean the bundle was built from different source than it shipped with.
		throw new Error(
			`No entry point named "${name}". The generated globals and the registry ` +
				`are out of step — rebuild rather than editing the bundle.`,
		);
	}

	// Deliberately NOT caught. An Apps Script trigger surfaces a thrown error in
	// the executions dashboard and does nothing whatsoever with a logged one, so
	// swallowing this would turn a failed nightly run into a silent success —
	// the exact failure mode the async ban also exists to prevent.
	entryPoint.run(createRuntime(), { dryRun });
}
