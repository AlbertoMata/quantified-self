// ─────────────────────────────────────────────────────────────────────────────
// KeyValueStore over Script Properties
//
// ⚠️ This store is SHARED with the running legacy sync. Script Properties are
// per-project, and the port develops inside the production project, so both
// implementations read and write the same drawer. Advancing TODOIST_LAST_SYNC
// from here would make the legacy nightly run skip that window and lose
// Completions rows permanently.
//
// The PORT_ prefix rule is what prevents that, and B4b wraps this store to
// enforce it. This adapter stays deliberately plain — a guard built into the
// only implementation is a guard that cannot be tested independently of it.
// ─────────────────────────────────────────────────────────────────────────────

import type { KeyValueStore } from "../../ports/key-value-store.ts";
import type { GasPropertiesService } from "./gas-types.ts";

export function createGasKeyValueStore(
	propertiesService: GasPropertiesService,
): KeyValueStore {
	// Fetched once: getScriptProperties() is a service handle, and the legacy
	// code re-acquires it on every call for no benefit.
	const properties = propertiesService.getScriptProperties();

	return {
		read(key: string): string | null {
			return properties.getProperty(key);
		},
		write(key: string, value: string): void {
			properties.setProperty(key, value);
		},
	};
}
