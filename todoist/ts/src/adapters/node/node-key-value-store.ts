// KeyValueStore over a `_State` tab — NOT YET IMPLEMENTED (F2).
//
// A GitHub runner has no Script Properties, and the cursor has to survive
// between runs. The plan's answer is a `_State` tab in the same spreadsheet:
// Actions' cache expires after 7 days, committing state to the repo is noisy,
// and a tab needs no new credential beyond the one the TableStore already has.
//
// ⚠️ It is NOT the same store as the Apps Script side. Script Properties and a
// `_State` tab are two different drawers, so a cutover from one runtime to the
// other has to copy the cursor across — exactly the migration step that would
// otherwise be discovered by finding a gap in Completions afterwards. An open
// question in the plan asks whether `_State` belongs in the data spreadsheet at
// all, given it would sit one accidental sort away from the data it guards.

import type { KeyValueStore } from "../../ports/key-value-store.ts";
import { notImplemented } from "./not-implemented.ts";

export function createNodeKeyValueStore(): KeyValueStore {
	return {
		read: () => notImplemented("KeyValueStore.read", "F2"),
		write: () => notImplemented("KeyValueStore.write", "F2"),
	};
}
