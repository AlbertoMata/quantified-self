// The Node runtime — assembled now, filled in at F2.
//
// It exists in Phase B so the shape is settled while the decisions are fresh,
// and so the layering test has something to check on both sides of the seam.
// Four of the seven ports are real already; three throw until F2.
//
// The guards are applied here exactly as they are for Apps Script. A runner
// writing straight into production tabs is, if anything, the more dangerous of
// the two: F1 grants a service account Editor on the live spreadsheet, and
// until F5 the only thing between a misconfigured workflow and four years of
// rows is this wrapper.

import { guardKeyValueStore, guardTableStore } from "../../core/guards.ts";
import type { Runtime } from "../../ports/index.ts";
import { createNodeCacheStore } from "./node-cache-store.ts";
import { createNodeClock } from "./node-clock.ts";
import { createNodeHttpTransport } from "./node-http.ts";
import { createNodeIdGenerator } from "./node-id-generator.ts";
import { createNodeKeyValueStore } from "./node-key-value-store.ts";
import { createNodeLogger } from "./node-logger.ts";
import { createNodeTableStore } from "./node-table-store.ts";

export interface NodeRuntimeOptions {
	// Same rule as the Apps Script side: an explicit `true` at the call site,
	// never a config value, and correct only at the E4/F5 cutovers.
	readonly allowProductionWrites?: boolean;
}

export function createNodeRuntime(options: NodeRuntimeOptions = {}): Runtime {
	const unguarded = options.allowProductionWrites === true;

	return {
		http: createNodeHttpTransport(),
		tables: guardTableStore(createNodeTableStore(), {
			allowProductionTabs: unguarded,
		}),
		state: guardKeyValueStore(createNodeKeyValueStore(), {
			allowProductionKeys: unguarded,
		}),
		cache: createNodeCacheStore(),
		clock: createNodeClock(),
		logger: createNodeLogger(),
		ids: createNodeIdGenerator(),
		// process.env is the runner's Script Properties. Reading it here rather
		// than snapshotting keeps a long-lived CLI honest about a changed value.
		settings: (key) => process.env[key] ?? null,
	};
}
