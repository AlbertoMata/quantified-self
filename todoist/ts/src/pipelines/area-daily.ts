// ─────────────────────────────────────────────────────────────────────────────
// AreaDaily — dense area × day counts, and the first HYBRID tab
//
// Columns C–F are SNAPSHOT: what was open, overdue, in the week and p1 at the
// moment the run took them. Column G is DERIVED from `Completions` and can be
// rebuilt for any past day.
//
// ⚠️ THE SNAPSHOT COLUMNS CANNOT BE BACKFILLED. Todoist keeps no history of what
// was open on a past date, so a missed day is a permanent hole in C–F even
// though G can be refilled. That asymmetry is exactly what `counts_observed`
// exists to mark: TRUE when C–F are real observations, so a backfilled row is
// never silently averaged in as though it had been measured.
//
// Every area gets a row every day, INCLUDING `uncategorized`. Its count is a
// metric in its own right — a rising uncategorized line means the taxonomy is
// drifting.
// ─────────────────────────────────────────────────────────────────────────────

import {
	AREA_UNCATEGORIZED,
	isInWeek,
	resolveArea,
	type AreaMap,
	type ProjectTree,
} from "../core/areas.ts";
import {
	cellValueToLocalDay,
	daysBetweenDays,
	type DayKey,
} from "../core/dates.ts";
import { toLabelList } from "../core/labels.ts";
import { replaceWhere, type WritePlan } from "../core/write-plan.ts";
import type { Row } from "../ports/values.ts";
import type { TodoistTask } from "../services/todoist/responses.ts";

export const AREA_DAILY_HEADER: Row = [
	"snapshot_date", // A
	"area", // B
	"open", // C — snapshot only
	"overdue", // D — snapshot only
	"in_week", // E — snapshot only
	"p1_open", // F — snapshot only
	"completed", // G — derived from Completions, backfillable
	"counts_observed", // H — TRUE when C–F are real observations
];

const SNAPSHOT_DATE_COLUMN = 0;

// Completions positions, read positionally.
const COMPLETED_AT = 0;
const PROJECT_ID = 3;
const LABELS = 6;
const AREA = 14;

// Todoist's API numbers priority 4 = p1 (highest). The UI label and the wire
// value run in OPPOSITE directions, which is an easy off-by-three.
const API_PRIORITY_P1 = 4;

export interface AreaDailySnapshot {
	readonly openTasks: readonly TodoistTask[];
	readonly completionRows: readonly Row[];
	readonly projectTree: ProjectTree;
	readonly areaMap: AreaMap;
	readonly timezone: string;
}

interface AreaCounts {
	open: number;
	overdue: number;
	inWeek: number;
	p1Open: number;
}

// Every area that gets a row, in a fixed order.
export function areaDailyAreas(map: AreaMap): string[] {
	return [...map.order, AREA_UNCATEGORIZED];
}

// Completions grouped by LOCAL day and area.
//
// Prefers the stored area column but derives it when blank, so this works before
// the area backfill has ever run.
export function completionCountsByDayArea(
	snapshot: AreaDailySnapshot,
): Map<DayKey, Map<string, number>> {
	const counts = new Map<DayKey, Map<string, number>>();

	for (const row of snapshot.completionRows.slice(1)) {
		const day = cellValueToLocalDay(
			row[COMPLETED_AT],
			snapshot.timezone,
		);
		if (!day) continue;

		const stored = String(row[AREA] ?? "").trim();
		const area =
			stored ||
			resolveArea(
				row[PROJECT_ID],
				toLabelList(row[LABELS]),
				snapshot.projectTree,
				snapshot.areaMap,
			).area;

		const forDay = counts.get(day) ?? new Map<string, number>();
		forDay.set(area, (forDay.get(area) ?? 0) + 1);
		counts.set(day, forDay);
	}
	return counts;
}

export function buildAreaDailyRows(
	snapshot: AreaDailySnapshot,
	today: DayKey,
): Row[] {
	const areas = areaDailyAreas(snapshot.areaMap);
	const counts = new Map<string, AreaCounts>();
	for (const area of areas) {
		counts.set(area, { open: 0, overdue: 0, inWeek: 0, p1Open: 0 });
	}

	for (const task of snapshot.openTasks) {
		const projectId = String(task.project_id ?? "");
		const { area } = resolveArea(
			projectId,
			task.labels,
			snapshot.projectTree,
			snapshot.areaMap,
		);
		// An area resolved from a label that is not in the map still gets a
		// bucket — dropping it would lose the task from the totals entirely.
		const bucket = counts.get(area) ?? {
			open: 0,
			overdue: 0,
			inWeek: 0,
			p1Open: 0,
		};
		counts.set(area, bucket);

		bucket.open += 1;

		const due = String(task.due?.date ?? "").slice(0, 10);
		if (due) {
			const late = daysBetweenDays(due, today);
			if (late !== null && late > 0) bucket.overdue += 1;
		}
		if (isInWeek(projectId, snapshot.areaMap)) bucket.inWeek += 1;
		if (Number(task.priority) === API_PRIORITY_P1)
			bucket.p1Open += 1;
	}

	const completedToday =
		completionCountsByDayArea(snapshot).get(today) ??
		new Map<string, number>();

	// Iterate the declared areas, not the counts map, so the row set is stable
	// day to day even when an area happens to have nothing in it.
	return [...new Set([...areas, ...counts.keys()])].map((area) => {
		const bucket = counts.get(area) ?? {
			open: 0,
			overdue: 0,
			inWeek: 0,
			p1Open: 0,
		};
		return [
			today,
			area,
			bucket.open,
			bucket.overdue,
			bucket.inWeek,
			bucket.p1Open,
			completedToday.get(area) ?? 0,
			// TRUE because these counts were observed right now. A backfill
			// writes FALSE, which is the whole point of the column.
			"TRUE",
		];
	});
}

export function planAreaDaily(
	snapshot: AreaDailySnapshot,
	tab: string,
	today: DayKey,
): WritePlan {
	const rows = buildAreaDailyRows(snapshot, today);

	return {
		// `onOrAfter` rather than `equals`: the legacy idiom clears today AND
		// anything later, so a row written under a wrong future date — by a
		// clock skew, or a hand-edited cell — cannot linger for ever.
		writes: [
			replaceWhere(
				tab,
				SNAPSHOT_DATE_COLUMN,
				{ onOrAfter: today },
				rows,
			),
		],
		stateToPersist: {},
		logLines: [
			`AreaDaily: ${rows.length} area row(s) for ${today} from ` +
				`${snapshot.openTasks.length} open task(s)`,
		],
	};
}
