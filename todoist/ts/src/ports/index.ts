// ─────────────────────────────────────────────────────────────────────────────
// The seam
//
// Everything above this directory is pure and runs anywhere. Everything below
// it — src/adapters/gas/ and src/adapters/node/ — is platform code, and those
// are the only two places a Google global or a Node built-in may be named. Step
// B6 turns that sentence into a test, which is what will still be enforcing it
// a year from now when neither of us remembers this file.
//
// There are no implementations here on purpose. A port is a statement of what
// the pipelines need; an adapter is a claim that a platform can provide it. If
// a pipeline ever needs something not described here, that is a design event
// worth noticing — which is exactly how IdGenerator turned up, when the plan's
// list of six ports met Utilities.getUuid() in the reschedule path.
// ─────────────────────────────────────────────────────────────────────────────

export type { CellValue, Row, TableName } from "./values.ts";
export type { HttpResponse, HttpTransport } from "./http.ts";
export type { TableStore } from "./table-store.ts";
export type { KeyValueStore } from "./key-value-store.ts";
export type { CacheStore } from "./cache-store.ts";
export type { Clock } from "./clock.ts";
export type { Logger } from "./logger.ts";
export type { IdGenerator } from "./id-generator.ts";
export type { SettingLookup } from "./settings.ts";

import type { CacheStore } from "./cache-store.ts";
import type { Clock } from "./clock.ts";
import type { HttpTransport } from "./http.ts";
import type { IdGenerator } from "./id-generator.ts";
import type { KeyValueStore } from "./key-value-store.ts";
import type { Logger } from "./logger.ts";
import type { SettingLookup } from "./settings.ts";
import type { TableStore } from "./table-store.ts";

// Every port an entry point can hand to the code beneath it. Bundling them into
// one value is what keeps an entry point at ~8 lines: createGasRuntime() once,
// then pass `runtime` down, rather than threading seven parameters through
// every call.
//
// A test builds this from fakes and needs no platform at all — which is the
// practical proof that the seam holds.
export interface Runtime {
	readonly http: HttpTransport;
	readonly tables: TableStore;
	readonly state: KeyValueStore;
	readonly cache: CacheStore;
	readonly clock: Clock;
	readonly logger: Logger;
	readonly ids: IdGenerator;
	// Configuration, read on demand. Not a snapshot: a pipeline asks for what
	// it needs, and requireSetting turns an absent value into an error rather
	// than a default aimed at production.
	readonly settings: SettingLookup;
}
