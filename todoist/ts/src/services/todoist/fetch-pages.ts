// ─────────────────────────────────────────────────────────────────────────────
// Fetching every page of a Todoist list endpoint
//
// The one impure function in services/, and it names no platform: it takes an
// HttpTransport, a Clock and a Logger, so it runs identically under Apps Script
// and Node — and under a fake in a test, which is how the pagination rules below
// are verified without touching the network.
//
// The verb says so. `fetch*` touches the outside world; everything else in this
// directory is `build*` or `parse*` and does not.
// ─────────────────────────────────────────────────────────────────────────────

import type { Clock } from "../../ports/clock.ts";
import type { HttpTransport } from "../../ports/http.ts";
import type { Logger } from "../../ports/logger.ts";
import {
	authHeaders,
	buildUrl,
	TODOIST_MAX_PAGES,
	TODOIST_PAGE_DELAY_MS,
	type TodoistRequest,
} from "./requests.ts";
import { describeHttpFailure, parsePage } from "./responses.ts";

export interface FetchContext {
	readonly http: HttpTransport;
	readonly clock: Clock;
	readonly logger: Logger;
	readonly token: string;
}

// Follow the cursor until there is nothing left, and return every item.
//
// Whole-collection reads are the existing behaviour, not a simplification: the
// pipelines need the snapshot in memory to compute a plan, and the largest list
// here is a few hundred tasks.
export function fetchAllTodoistPages<Item>(
	context: FetchContext,
	request: TodoistRequest,
): Item[] {
	const all: Item[] = [];
	let cursor: string | null = null;
	let pagesFetched = 0;

	while (pagesFetched < TODOIST_MAX_PAGES) {
		const response = context.http.get(
			buildUrl(request, cursor),
			authHeaders(context.token),
		);

		// Status is data, not an exception — but a failed page IS fatal here.
		// Returning what we have so far would look like a short list rather
		// than a broken call, and for an append-only tab that silently loses
		// history.
		if (response.status >= 300) {
			throw new Error(
				describeHttpFailure(
					request.path,
					response.status,
					response.body,
				),
			);
		}

		const page = parsePage<Item>(response.body);
		all.push(...page.items);
		pagesFetched += 1;

		context.logger.log(
			`${request.path} page ${pagesFetched}: ${page.items.length} items ` +
				`(total ${all.length}), more=${page.nextCursor !== null}`,
		);

		// An EMPTY page stops the loop even when a cursor came back. Some
		// endpoints hand out a cursor indefinitely with nothing in the batch —
		// observed on /activities — and a loop trusting the cursor alone runs
		// until the 6-minute cap kills it mid-write.
		if (page.items.length === 0) break;
		if (page.nextCursor === null) break;

		cursor = page.nextCursor;
		// Courtesy delay. The rate limit is per token and there is exactly one,
		// shared with the legacy sync for the whole of Phase E.
		context.clock.sleep(TODOIST_PAGE_DELAY_MS);
	}

	if (pagesFetched >= TODOIST_MAX_PAGES) {
		context.logger.log(
			`${request.path}: stopped at the ${TODOIST_MAX_PAGES}-page budget. ` +
				`Either the list is genuinely enormous or a cursor is not clearing.`,
		);
	}

	return all;
}
