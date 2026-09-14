// ─────────────────────────────────────────────────────────────────────────────
// Completions — the hardest pipeline, and the only irreplaceable one
//
// Append-only history. Todoist's activity log retains roughly 12 months, so a
// row lost here is lost permanently once that window passes. Everything below is
// shaped by that.
//
// THREE SOURCES, and the first two are DISJOINT by construction:
//
//   1. One-off completions   → /tasks/completed/by_completion_date
//      Full task objects. Recurring check-offs NEVER appear here — verified
//      live: the Habits project returns 0 rows even on days it was checked off.
//
//   2. Recurring check-offs  → /activities, event_type=completed, is_recurring
//      extra_data carries content, labels, parent_id and priority, so the events
//      are essentially complete on their own. Two traps: the PROJECT is at the
//      top level as parent_project_id rather than in extra_data, and due_date is
//      already the NEXT occurrence — the completed one is completed_due_date.
//
//   3. In Review membership  → a filter query, and NOT AN EVENT
//      A state snapshot. Only tasks that ENTERED since the last run count, so a
//      task is recorded the day it moves in — and again if it later leaves and
//      re-enters. That diff is why this pipeline carries state at all.
//
// Because 1 and 2 are disjoint, the same completion cannot arrive twice from
// them, and labels populate for both task types without a fragile task_id join.
// ─────────────────────────────────────────────────────────────────────────────

import { resolveArea, type AreaMap, type ProjectTree } from "../core/areas.ts";
import type { DayKey } from "../core/dates.ts";
import {
	completionKey,
	completionKeyFromRow,
	keySetFromRows,
} from "../core/keys.ts";
import { extractComplexity, toLabelList } from "../core/labels.ts";
import { durationMinutes } from "../core/numbers.ts";
import { appendTo, type WritePlan } from "../core/write-plan.ts";
import type { Row } from "../ports/values.ts";

// Columns A–N predate every header convention here and are read POSITIONALLY by
// several callers; O–Q were appended with the life-areas work.
export const COMPLETIONS_HEADER: Row = [
	"completed_at", // A
	"task_id", // B
	"content", // C
	"project_id", // D
	"project_name", // E
	"section_name", // F
	"labels", // G
	"priority", // H
	"is_recurring", // I
	"due_date", // J
	"duration_minutes", // K
	"synced_on", // L
	"parent_id", // M
	"complexity", // N
	"area", // O
	"area_source", // P
	"was_overdue", // Q
];

const COMPLETED_AT_COLUMN = 0;
const TASK_ID_COLUMN = 1;

// The state keys this pipeline owns. PORT_-prefixed because the store is shared
// with the running legacy sync — writing the unprefixed names would advance its
// cursor and make the nightly run skip a window.
export const PORT_LAST_SYNC_KEY = "PORT_TODOIST_LAST_SYNC";
export const PORT_IN_REVIEW_PREV_KEY = "PORT_TODOIST_IN_REVIEW_PREV";

// A completion, normalised from whichever source produced it.
export interface CompletionEvent {
	readonly id?: string | number;
	readonly completed_at?: string;
	readonly content?: string;
	readonly project_id?: string | number;
	readonly section_id?: string | number | null;
	readonly parent_id?: string | number | null;
	readonly labels?: readonly string[];
	readonly priority?: number;
	readonly duration?: unknown;
	readonly due?: {
		readonly date?: string;
		readonly is_recurring?: boolean;
	} | null;
	// Only recurring activity events carry this. Undefined means UNKNOWN, and
	// unknown must not read as "on time".
	readonly was_overdue?: boolean | null;
}

export interface CompletionsSnapshot {
	readonly oneOffCompletions: readonly CompletionEvent[];
	readonly recurringCompletions: readonly CompletionEvent[];
	// Everything currently in an In Review section, not only what is new.
	readonly inReviewTasks: readonly CompletionEvent[];
	// Task ids that were in In Review at the END of the previous run.
	readonly previousInReviewIds: ReadonlySet<string>;
	// The tab as it stands, header included, for dedup.
	readonly existingRows: readonly Row[];
	readonly projectNamesById: Readonly<Record<string, string>>;
	readonly sectionNamesById: Readonly<Record<string, string>>;
	readonly projectTree: ProjectTree;
	readonly areaMap: AreaMap;
}

// One row, from one completion.
//
// `syncedOn` and `fallbackCompletedAt` are passed in rather than read from a
// clock, so this stays pure and a test can pin both.
export function buildCompletionRow(
	event: CompletionEvent,
	snapshot: CompletionsSnapshot,
	syncedOn: DayKey,
	fallbackCompletedAt: string,
): Row {
	const labels = toLabelList(event.labels);

	// Label first, then the project tree. CAPTURED AT WRITE TIME, so the row
	// records what was true then — labels are frozen here, which is exactly why
	// historical rows must be re-derived from project_id rather than re-read.
	const resolved = resolveArea(
		event.project_id,
		labels,
		snapshot.projectTree,
		snapshot.areaMap,
	);

	return [
		event.completed_at || fallbackCompletedAt,
		String(event.id ?? ""),
		event.content ?? "",
		event.project_id ? String(event.project_id) : "",
		snapshot.projectNamesById[String(event.project_id ?? "")] ?? "",
		event.section_id === undefined || event.section_id === null
			? ""
			: (snapshot.sectionNamesById[
					String(event.section_id)
				] ?? ""),
		labels.join(","),
		event.priority ?? 1,
		event.due?.is_recurring === true ? "TRUE" : "FALSE",
		event.due?.date ?? "",
		durationMinutes(event.duration) ?? "",
		syncedOn,
		event.parent_id === undefined || event.parent_id === null
			? ""
			: String(event.parent_id),
		extractComplexity(labels) ?? "",
		resolved.area,
		resolved.source,
		// Blank, NOT FALSE, when the source cannot say: only recurring activity
		// events carry it, and "unknown" must not read as "closed on time".
		event.was_overdue === undefined || event.was_overdue === null
			? ""
			: event.was_overdue
				? "TRUE"
				: "FALSE",
	];
}

// Which In Review tasks ENTERED since the last run.
//
// The diff is the whole mechanism: In Review is a state, not an event, so
// counting everything currently there would re-record the same task every night
// until it moved out.
export function newlyInReview(
	snapshot: CompletionsSnapshot,
): CompletionEvent[] {
	return snapshot.inReviewTasks.filter(
		(task) =>
			!snapshot.previousInReviewIds.has(
				String(task.id ?? ""),
			),
	);
}

export function planCompletions(
	snapshot: CompletionsSnapshot,
	tab: string,
	syncedOn: DayKey,
	// The instant this run covers up to. Becomes the new cursor, and the
	// completed_at fallback for an event that carries none.
	until: Date,
): WritePlan {
	const sectionMovements = newlyInReview(snapshot);
	const candidates = [
		...snapshot.oneOffCompletions,
		...snapshot.recurringCompletions,
		...sectionMovements,
	];

	const existingKeys = keySetFromRows(
		snapshot.existingRows.slice(1),
		(row) =>
			completionKeyFromRow(
				row[COMPLETED_AT_COLUMN],
				row[TASK_ID_COLUMN],
			),
	);

	const fallbackCompletedAt = until.toISOString();
	const seenThisRun = new Set<string>();
	const rows: Row[] = [];
	let droppedWithoutId = 0;
	let duplicates = 0;

	for (const event of candidates) {
		// A completion we cannot tie to a task is DROPPED, not stored. Without
		// an id it can never be deduped, so it would re-append every night.
		if (!event.id) {
			droppedWithoutId += 1;
			continue;
		}

		const key = completionKey(event.id, event.completed_at ?? "");
		// Two checks, not one: against the tab, and against this run. The second
		// matters because a task can be in In Review AND have a one-off
		// completion in the same window.
		if (existingKeys.has(key) || seenThisRun.has(key)) {
			duplicates += 1;
			continue;
		}
		seenThisRun.add(key);
		rows.push(
			buildCompletionRow(
				event,
				snapshot,
				syncedOn,
				fallbackCompletedAt,
			),
		);
	}

	const logLines = [
		`Completions: ${snapshot.oneOffCompletions.length} one-off, ` +
			`${snapshot.recurringCompletions.length} recurring, ` +
			`${sectionMovements.length} new In Review ` +
			`(of ${snapshot.inReviewTasks.length} currently there)`,
		`Completions: appending ${rows.length} row(s), ${duplicates} already present`,
	];
	if (droppedWithoutId > 0) {
		logLines.push(
			`Completions: dropped ${droppedWithoutId} event(s) with no task id`,
		);
	}

	return {
		// APPEND ONLY. This tab never replaces and never clears — its rows are
		// history that cannot be re-fetched once Todoist's ~12-month activity
		// retention passes.
		writes: [appendTo(tab, rows)],

		// Persisted only AFTER the rows land, which the applier guarantees.
		//
		// Both keys matter for the same reason: advancing the cursor before the
		// rows are written means the next run starts past completions that were
		// never recorded — a permanent hole. The In Review baseline is the same
		// hazard in a different shape: move it forward without writing the rows
		// and those tasks never count as entering at all.
		stateToPersist: {
			[PORT_LAST_SYNC_KEY]: until.toISOString(),
			[PORT_IN_REVIEW_PREV_KEY]: JSON.stringify(
				snapshot.inReviewTasks.map((task) =>
					String(task.id ?? ""),
				),
			),
		},
		logLines,
	};
}

// Read the persisted In Review membership back.
//
// Tolerates absent and malformed state by returning an empty set, which makes
// the next run treat everything currently in review as new — a one-time
// over-count rather than a silent under-count. That is the right way round: a
// duplicate row is visible and removable, a missing one is neither.
export function parseInReviewIds(raw: string | null): Set<string> {
	if (!raw) return new Set();
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return new Set();
		return new Set(parsed.map((id) => String(id)));
	} catch {
		return new Set();
	}
}
