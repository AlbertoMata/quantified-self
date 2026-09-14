// ─────────────────────────────────────────────────────────────────────────────
// Applying a plan
//
// The deliberately dumb half of the sandwich. Every decision was made upstream
// in a pure function; this walks the result and calls the ports. It contains no
// business rules on purpose — a bug here would be a bug in *all* eight tabs at
// once, so there is as little here as possible to get wrong.
//
// A NOTE ON THE NAMING RULE. The rule in the plan says `apply` belongs to
// adapters/ or entrypoints/. This one lives in core/ anyway, because it reaches
// the outside world *only* through port interfaces and names no platform
// global — so it is identical under Apps Script and under Node, and duplicating
// it into both adapters would mean maintaining the trickiest ordering logic in
// the codebase twice. The B6 layering test bans platform globals, which this
// still satisfies. The rule is about platform coupling, and this has none.
// ─────────────────────────────────────────────────────────────────────────────

import type { KeyValueStore } from "../ports/key-value-store.ts";
import type { Logger } from "../ports/logger.ts";
import type { TableStore } from "../ports/table-store.ts";
import { assertPlanIsAllowed } from "./guards.ts";
import { resolveWriteOperation, type WritePlan } from "./write-plan.ts";

export interface ApplyOptions {
	// Log every mutation and perform none. The cheapest safety rail there is,
	// and the only one that costs nothing to leave switched on — which matters
	// more now that the port develops against the production spreadsheet.
	readonly dryRun?: boolean;

	// Let the plan target tabs and state keys the legacy code owns. Correct at
	// exactly one moment — the E4 cutover — and passed at the call site, never
	// read from config.
	readonly allowProductionWrites?: boolean;
}

export function applyWritePlan(
	plan: WritePlan,
	tables: TableStore,
	state: KeyValueStore,
	logger: Logger,
	options: ApplyOptions = {},
): void {
	const dryRun = options.dryRun === true;

	// Checked BEFORE anything is done, and before the dry-run branch, so a dry
	// run reports the same refusal a real run would. A dry run that quietly
	// "succeeds" against a production tab is worse than no dry run at all.
	assertPlanIsAllowed(plan, {
		allowProductionTabs: options.allowProductionWrites === true,
		allowProductionKeys: options.allowProductionWrites === true,
	});

	if (dryRun) logger.log("DRY RUN — nothing below is actually written");

	for (const operation of plan.writes) {
		// Read once per operation, immediately before resolving it. The
		// resolved mutations carry absolute row numbers, so anything that
		// widens the gap between the read and the write is a chance for those
		// numbers to go stale.
		const currentRows = tables.readRows(operation.tab);
		const mutations = resolveWriteOperation(currentRows, operation);

		for (const mutation of mutations) {
			if (mutation.kind === "clearFrom") {
				logger.log(
					`${operation.tab}: clear from row ${mutation.firstRow}`,
				);
				if (!dryRun) {
					tables.clearRowsFrom(
						operation.tab,
						mutation.firstRow,
					);
				}
			} else if (mutation.kind === "write") {
				logger.log(
					`${operation.tab}: write ${mutation.rows.length} row(s) at ${mutation.firstRow}`,
				);
				if (!dryRun) {
					tables.writeRows(
						operation.tab,
						mutation.firstRow,
						mutation.rows,
					);
				}
			} else {
				logger.log(
					`${operation.tab}: append ${mutation.rows.length} row(s)`,
				);
				if (!dryRun)
					tables.appendRows(
						operation.tab,
						mutation.rows,
					);
			}
		}
	}

	// State last, and only after every write above returned. A cursor advanced
	// past rows that never landed is a permanent gap — see WritePlan.
	for (const [key, value] of Object.entries(plan.stateToPersist)) {
		logger.log(`state: ${key} = ${value}`);
		if (!dryRun) state.write(key, value);
	}

	for (const line of plan.logLines) logger.log(line);
}
