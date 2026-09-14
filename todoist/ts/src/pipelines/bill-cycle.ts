// ─────────────────────────────────────────────────────────────────────────────
// BillCycle — one row per bill per cycle, rebuilt from scratch every night
//
// The first tab derived from `Completions` rather than fetched from Todoist.
// Two sources meet here:
//   * `Completions` is the TRUTH for CLOSED cycles — which occurrence closed,
//     when, and Todoist's own `was_overdue` verdict.
//   * The live task list supplies the ONE still-open cycle per bill, and the
//     bill's current name.
//
// ⚠️ ADMINISTRATIVE TIMELINESS, NOT PAYMENT TIMELINESS. Todoist records when you
// ticked the box; it has no idea when money moved. The whole reasoning is in
// core/bill-cycle.ts, which this pipeline only arranges rows around.
//
// KNOWN GAP, documented rather than solved: a cycle that was NEVER closed leaves
// no completion event, so skipped cycles are invisible. This undercounts rather
// than fabricating, which is the house rule.
// ─────────────────────────────────────────────────────────────────────────────

import { resolveArea, type AreaMap, type ProjectTree } from "../core/areas.ts";
import {
	billCycleStatus,
	cycleOf,
	daysToClose,
	nextOnTimeCloseStreak,
	type WasOverdue,
} from "../core/bill-cycle.ts";
import {
	cellValueToDayKey,
	cellValueToLocalDay,
	type DayKey,
} from "../core/dates.ts";
import { toLabelList } from "../core/labels.ts";
import { replaceWhere, type WritePlan } from "../core/write-plan.ts";
import type { Row } from "../ports/values.ts";
import type { TodoistTask } from "../services/todoist/responses.ts";

export const BILL_CYCLE_HEADER: Row = [
	"bill", // A
	"task_id", // B
	"area", // C
	"project_name", // D
	"cycle", // E — YYYY-MM, from cycle_due_date
	"cycle_due_date", // F
	"closed_at", // G — local day it was ticked; blank while open
	"days_to_close", // H — negative = closed early; vs today while open
	"status", // I
	"was_overdue", // J — Todoist's own flag; blank = unknown
	"is_recurring", // K
	"on_time_close_streak", // L
];

export const BILL_AREA = "bills-taxes";

// Completions column positions, which are read POSITIONALLY because that tab
// predates every header convention in the project.
const COMPLETED_AT = 0;
const TASK_ID = 1;
const CONTENT = 2;
const PROJECT_ID = 3;
const PROJECT_NAME = 4;
const LABELS = 6;
const IS_RECURRING = 8;
const DUE_DATE = 9;
const AREA = 14;
const WAS_OVERDUE = 16;

interface Cycle {
	bill: string;
	taskId: string;
	projectName: string;
	cycleDueDate: DayKey;
	closedAt: DayKey | "";
	wasOverdue: WasOverdue;
	isRecurring: "TRUE" | "FALSE";
}

export interface BillCycleSnapshot {
	readonly completionRows: readonly Row[];
	readonly liveTasks: readonly TodoistTask[];
	readonly projectTree: ProjectTree;
	readonly areaMap: AreaMap;
	readonly timezone: string;
}

export function buildBillCycleRows(
	snapshot: BillCycleSnapshot,
	today: DayKey,
): { rows: Row[]; skippedWithoutDueDate: number } {
	const cycles = new Map<string, Cycle>();
	// The live list is the authority on a bill's CURRENT name — a renamed bill
	// should not show its old name on historical cycles.
	const currentNames = new Map<string, string>();
	for (const task of snapshot.liveTasks) {
		currentNames.set(String(task.id ?? ""), task.content ?? "");
	}

	let skippedWithoutDueDate = 0;

	// ── Closed cycles, from Completions ──────────────────────────────────
	for (const row of snapshot.completionRows.slice(1)) {
		// Prefer the STORED area but derive it when the column is blank: this
		// tab has to work before the area backfill has ever run.
		const stored = String(row[AREA] ?? "").trim();
		const area =
			stored ||
			resolveArea(
				row[PROJECT_ID],
				toLabelList(row[LABELS]),
				snapshot.projectTree,
				snapshot.areaMap,
			).area;
		if (area !== BILL_AREA) continue;

		const cycleDueDate = cellValueToDayKey(row[DUE_DATE]).slice(
			0,
			10,
		);
		if (!cycleDueDate) {
			// No occurrence to attribute the cycle to. COUNTED, not guessed at.
			skippedWithoutDueDate += 1;
			continue;
		}

		const taskId = String(row[TASK_ID] ?? "");
		const key = `${taskId}|${cycleDueDate}`;
		const closedAt = cellValueToLocalDay(
			row[COMPLETED_AT],
			snapshot.timezone,
		);

		// A cycle can appear twice if it was un-completed and re-completed. The
		// FIRST close answers "did this cycle close on time", so keep the
		// earliest and ignore any later one.
		const existing = cycles.get(key);
		if (
			existing &&
			existing.closedAt !== "" &&
			existing.closedAt <= closedAt
		) {
			continue;
		}

		cycles.set(key, {
			bill:
				currentNames.get(taskId) ||
				String(row[CONTENT] ?? ""),
			taskId,
			projectName: String(row[PROJECT_NAME] ?? ""),
			cycleDueDate,
			closedAt,
			wasOverdue: String(row[WAS_OVERDUE] ?? "")
				.trim()
				.toUpperCase() as WasOverdue,
			isRecurring:
				String(
					row[IS_RECURRING] ?? "",
				).toUpperCase() === "TRUE"
					? "TRUE"
					: "FALSE",
		});
	}

	// ── The one open cycle per bill, from the live list ──────────────────
	for (const task of snapshot.liveTasks) {
		const projectId = String(task.project_id ?? "");
		const area = resolveArea(
			projectId,
			task.labels,
			snapshot.projectTree,
			snapshot.areaMap,
		).area;
		if (area !== BILL_AREA) continue;

		const due = String(task.due?.date ?? "").slice(0, 10);
		if (!due) continue; // an undated bill has no cycle to score

		const taskId = String(task.id ?? "");
		const key = `${taskId}|${due}`;
		// If this occurrence is already recorded as closed, the closed row wins.
		if (cycles.has(key)) continue;

		cycles.set(key, {
			bill: task.content ?? "",
			taskId,
			projectName:
				snapshot.projectTree[projectId]?.name ?? "",
			cycleDueDate: due,
			closedAt: "",
			wasOverdue: "",
			isRecurring:
				task.due?.is_recurring === true
					? "TRUE"
					: "FALSE",
		});
	}

	// ── Streaks, per bill, in cycle order ────────────────────────────────
	const byTask = new Map<string, Cycle[]>();
	for (const cycle of cycles.values()) {
		const list = byTask.get(cycle.taskId) ?? [];
		list.push(cycle);
		byTask.set(cycle.taskId, list);
	}

	const rows: Row[] = [];
	// Bills alphabetically, cycles chronologically within each — so the streak
	// accumulates in the order the cycles actually happened.
	const taskIds = [...byTask.keys()].sort((left, right) =>
		String(byTask.get(left)?.[0]?.bill ?? "").localeCompare(
			String(byTask.get(right)?.[0]?.bill ?? ""),
		),
	);

	for (const taskId of taskIds) {
		const list = [...(byTask.get(taskId) ?? [])].sort((a, b) =>
			a.cycleDueDate < b.cycleDueDate ? -1 : 1,
		);
		let streak = 0;
		for (const cycle of list) {
			const status = billCycleStatus(
				cycle.closedAt,
				cycle.cycleDueDate,
				cycle.wasOverdue,
				today,
			);
			streak = nextOnTimeCloseStreak(streak, status);
			rows.push([
				cycle.bill,
				cycle.taskId,
				BILL_AREA,
				cycle.projectName,
				cycleOf(cycle.cycleDueDate),
				cycle.cycleDueDate,
				cycle.closedAt,
				daysToClose(
					cycle.closedAt,
					cycle.cycleDueDate,
					today,
				) ?? "",
				status,
				cycle.wasOverdue ?? "",
				cycle.isRecurring,
				streak,
			]);
		}
	}

	return { rows, skippedWithoutDueDate };
}

export function planBillCycle(
	snapshot: BillCycleSnapshot,
	tab: string,
	today: DayKey,
): WritePlan {
	const { rows, skippedWithoutDueDate } = buildBillCycleRows(
		snapshot,
		today,
	);

	const logLines = [
		`BillCycle: ${rows.length} cycle row(s) rebuilt for ${today}`,
	];
	if (skippedWithoutDueDate > 0) {
		logLines.push(
			`BillCycle: ${skippedWithoutDueDate} bills-area completion(s) had no ` +
				`due_date and were skipped — they cannot be attributed to a cycle`,
		);
	}

	return {
		// A FULL REBUILD: every row is recomputed from Completions plus the live
		// list every night, so `{ all: true }` rather than a day predicate. This
		// is the case that made `Match` need a third variant.
		writes: [replaceWhere(tab, 0, { all: true }, rows)],
		stateToPersist: {},
		logLines,
	};
}
