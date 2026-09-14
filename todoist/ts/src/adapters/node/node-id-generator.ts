// IdGenerator over Node's crypto.
//
// randomUUID is a v4 UUID from a CSPRNG, which is what Todoist's /sync wants as
// a command's idempotency key. Utilities.getUuid() gives the same shape on the
// Apps Script side.

import { randomUUID } from "node:crypto";

import type { IdGenerator } from "../../ports/id-generator.ts";

export function createNodeIdGenerator(): IdGenerator {
	return {
		newUuid(): string {
			return randomUUID();
		},
	};
}
