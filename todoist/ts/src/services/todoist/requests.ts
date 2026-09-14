// ─────────────────────────────────────────────────────────────────────────────
// Todoist requests — DESCRIBED here, ISSUED in the adapter
//
// Everything in this file is pure. A request is a value: a path, some params,
// and what to do with the response. Nothing here touches the network, which is
// what makes the parsing and the pagination rule testable against fixtures
// rather than against Todoist's mood on the day.
// ─────────────────────────────────────────────────────────────────────────────

export const TODOIST_API_BASE = "https://api.todoist.com/api/v1";

// The safe per-page cap, and NOT a preference.
//
// The completed-tasks endpoint silently CLAMPS higher values on some accounts,
// which makes pages look complete when they are not — the worst possible
// failure for an append-only history tab, because it loses rows without
// erroring. Raising this is not an optimisation.
export const TODOIST_PAGE_LIMIT = 50;

// Courtesy delay between pages, in milliseconds. The rate limit is per token and
// there is only one token, so this is also what keeps a port run from starving
// the legacy run during Phase E.
export const TODOIST_PAGE_DELAY_MS = 300;

// A hard stop on pagination. Some endpoints hand out a cursor forever, so
// fetchAllTodoistPages needs a budget as well as a stop condition.
export const TODOIST_MAX_PAGES = 50;

export interface TodoistRequest {
	readonly path: string;
	readonly params: Readonly<Record<string, string | number | null>>;
}

// Build a query string, dropping empty and null params so `cursor=null` is
// omitted rather than sent as the literal string "null" — which Todoist would
// treat as a cursor and return nothing for.
export function buildQueryString(
	params: Readonly<Record<string, string | number | null | undefined>>,
): string {
	const pairs = Object.entries(params)
		.filter(
			([, value]) =>
				value !== undefined &&
				value !== null &&
				value !== "",
		)
		.map(
			([key, value]) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
		);
	return pairs.length > 0 ? `?${pairs.join("&")}` : "";
}

export function buildUrl(
	request: TodoistRequest,
	cursor: string | null,
): string {
	return `${TODOIST_API_BASE}${request.path}${buildQueryString({
		...request.params,
		cursor,
		limit: TODOIST_PAGE_LIMIT,
	})}`;
}

export function authHeaders(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` };
}

// ── The endpoints this project uses ──────────────────────────────────────────

// Overdue tasks. v1 takes a filter QUERY rather than the old `?filter=` param.
export function overdueTasksRequest(): TodoistRequest {
	return { path: "/tasks/filter", params: { query: "overdue" } };
}

// Every open task.
export function openTasksRequest(): TodoistRequest {
	return { path: "/tasks", params: {} };
}

export function projectsRequest(): TodoistRequest {
	return { path: "/projects", params: {} };
}

export function sectionsRequest(): TodoistRequest {
	return { path: "/sections", params: {} };
}

// Every active recurring task — the RecurringStatus spine.
export function recurringTasksRequest(): TodoistRequest {
	return { path: "/tasks/filter", params: { query: "recurring" } };
}

// One-off completions.
//
// NO annotate_items param. The v1 endpoint inlines all task fields by default,
// and passing the legacy Sync-v9 flag is exactly what previously left labels —
// and therefore complexity — blank for every one-off completion.
export function oneOffCompletionsRequest(
	since: string,
	until: string,
): TodoistRequest {
	return {
		path: "/tasks/completed/by_completion_date",
		params: { since, until },
	};
}

// Completion ACTIVITY events. Recurring check-offs are filtered out of this
// downstream — one-off completions come from the endpoint above, with fuller
// data, and the two sets are disjoint by construction.
export function completionActivitiesRequest(
	since: string,
	until: string,
): TodoistRequest {
	return {
		path: "/activities",
		params: {
			object_type: "item",
			event_type: "completed",
			since,
			until,
		},
	};
}

// Every open task in one section.
export function sectionTasksRequest(sectionId: string): TodoistRequest {
	return { path: "/tasks", params: { section_id: sectionId } };
}

// Tasks currently sitting in an In Review section of a target project.
//
// ⚠️ STILL NAME-BASED, and now a SINGLE-name query since Ascensus was retired.
// A rename of `Work` takes the whole source down silently — the filter returns
// 0 tasks rather than erroring. `#Work` binds to the child project, not the
// `💼 Work` parent, so the parent does not rescue it either. Converting this to
// project_id is logged in life-areas.md as worth doing during the port.
export function inReviewTasksRequest(
	projectNames: readonly string[],
	sectionName: string,
): TodoistRequest {
	const projectClause = projectNames
		.map((name) => `#${name}`)
		.join(" | ");
	return {
		path: "/tasks/filter",
		params: { query: `(${projectClause}) & /${sectionName}` },
	};
}
