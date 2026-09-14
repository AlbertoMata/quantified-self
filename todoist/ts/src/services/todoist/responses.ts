// ─────────────────────────────────────────────────────────────────────────────
// Todoist responses — parsing, and the pagination rule
//
// Pure. Given a response body, these say what it contained and whether to ask
// for more. The rules encoded here were all learned the hard way and are
// commented where they were.
// ─────────────────────────────────────────────────────────────────────────────

// A Todoist task, as much of it as this project reads. Everything is optional
// because the API omits rather than nulls, and a parser that assumed presence
// would throw on the first task without a due date.
export interface TodoistTask {
	readonly id?: string | number;
	readonly content?: string;
	readonly project_id?: string | number;
	readonly section_id?: string | number | null;
	readonly parent_id?: string | number | null;
	readonly labels?: readonly string[];
	readonly priority?: number;
	readonly due?: {
		readonly date?: string;
		readonly is_recurring?: boolean;
		readonly string?: string;
	} | null;
}

export interface TodoistProject {
	readonly id?: string | number;
	readonly name?: string;
	readonly parent_id?: string | number | null;
}

// A parsed page: the items it held, and where to continue from.
export interface TodoistPage<Item> {
	readonly items: readonly Item[];
	readonly nextCursor: string | null;
}

// Turn a response body into a page.
//
// THREE SHAPES, all real. v1 list endpoints return `{ results, next_cursor }`;
// some return `{ items }`; a few return a bare array and do not paginate at all.
// The legacy paginator handles all three and so does this.
export function parsePage<Item>(body: string): TodoistPage<Item> {
	const parsed = parseJsonBody(body);

	if (Array.isArray(parsed)) {
		// A non-paginated endpoint. No cursor means one page, by definition.
		return { items: parsed as Item[], nextCursor: null };
	}

	const record = parsed as {
		results?: unknown;
		items?: unknown;
		next_cursor?: unknown;
	};
	const items = Array.isArray(record.results)
		? record.results
		: Array.isArray(record.items)
			? record.items
			: [];

	const cursor = record.next_cursor;
	return {
		items: items as Item[],
		nextCursor:
			typeof cursor === "string" && cursor !== ""
				? cursor
				: null,
	};
}

// Parse a body, failing LEGIBLY when it is not JSON.
//
// Todoist answers a deprecated endpoint with HTML or plain text, and
// `JSON.parse` reports that as "Unexpected token <" — which tells you nothing
// about which call broke or why. This is what turns a silent nightly failure
// into a debuggable message.
export function parseJsonBody(body: string): unknown {
	const trimmed = (body ?? "").trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
		throw new Error(
			`Todoist returned non-JSON: ${trimmed.slice(0, 200)}`,
		);
	}
	return JSON.parse(trimmed);
}

// Describe an HTTP failure in a way that says what to do about it.
//
// 429 is called out because it is the one a Phase E parallel run will actually
// hit: two implementations share one token, and the limit is per token.
export function describeHttpFailure(
	path: string,
	status: number,
	body: string,
): string {
	const excerpt = (body ?? "").slice(0, 200);
	if (status === 429) {
		return (
			`Todoist ${path} → HTTP 429 (rate limited): ${excerpt}. ` +
			`The limit is per TOKEN, and the legacy sync shares this one — ` +
			`check whether both implementations ran at once.`
		);
	}
	if (status === 401 || status === 403) {
		return (
			`Todoist ${path} → HTTP ${status} (auth): ${excerpt}. ` +
			`Check the TODOIST_TOKEN Script Property.`
		);
	}
	return `Todoist ${path} → HTTP ${status}: ${excerpt}`;
}

// id → name, for a list of projects or sections.
export function toIdNameMap(
	items: readonly TodoistProject[],
): Record<string, string> {
	const map: Record<string, string> = {};
	for (const item of items) {
		if (item.id === undefined || item.id === null) continue;
		map[String(item.id)] = item.name ?? "";
	}
	return map;
}

// id → { name, parentId }, the tree area resolution walks.
export function toProjectTree(
	items: readonly TodoistProject[],
): Record<string, { name: string; parentId: string }> {
	const tree: Record<string, { name: string; parentId: string }> = {};
	for (const item of items) {
		if (item.id === undefined || item.id === null) continue;
		tree[String(item.id)] = {
			name: item.name ?? "",
			parentId:
				item.parent_id === undefined ||
				item.parent_id === null
					? ""
					: String(item.parent_id),
		};
	}
	return tree;
}
