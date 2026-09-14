// ─────────────────────────────────────────────────────────────────────────────
// TaskDaily — one row per open task per day, and the SELF-REFERENTIAL tab
//
// ⚠️ OBSERVED-ONLY, AND UNRECOVERABLE. Todoist keeps no history of what was open
// on a past date, so a missed day is a permanent hole no re-run can fill. Its
// aging columns read its OWN PREVIOUS DAY, which means a wrong row does not just
// sit there being wrong — it becomes the input to every row after it.
//
// That is why this file is careful in two specific places, both of which are
// silent when wrong:
//   * the prior state must come from the last day STRICTLY BEFORE today, or an
//     hourly re-run reads its own half-written rows and resets every section age
//     to zero;
//   * exit rows must be excluded from that prior state, or a task that left last
//     week is resurrected as a fresh exit row every single night.
// ─────────────────────────────────────────────────────────────────────────────

import {
	isInWeek,
	resolveArea,
	type AreaMap,
	type ProjectTree,
} from "../core/areas.ts";
import {
	cellValueToDayKey,
	daysBetweenDays,
	type DayKey,
} from "../core/dates.ts";
import { replaceWhere, type WritePlan } from "../core/write-plan.ts";
import type { CellValue, Row } from "../ports/values.ts";
import type { TodoistTask } from "../services/todoist/responses.ts";

export const TASK_DAILY_HEADER: Row = [
	"snapshot_date", // A
	"task_id", // B
	"content", // C
	"project_name", // D
	"area", // E
	"area_source", // F
	"in_week", // G
	"section_name", // H
	"work_stage", // I — normalised across incompatible vocabularies
	"labels", // J
	"priority", // K — API scale: 4 = p1
	"due_date", // L
	"deadline_date", // M — a fossil on recurring tasks
	"is_recurring", // N
	"is_subtask", // O
	"added_on", // P
	"days_in_project", // Q
	"section_entered_on", // R
	"days_in_section", // S
	"section_age_seeded", // T — TRUE when R is a floor, not an observation
	"days_overdue", // U — blank unless actually overdue
	"is_exit", // V — TRUE on the terminal row for a departed task
];

const SNAPSHOT_DATE = 0;
const TASK_ID = 1;
const SECTION_NAME = 7;
const SECTION_ENTERED_ON = 17;
const SECTION_AGE_SEEDED = 19;
const IS_EXIT = 21;

// Sections a task is BORN into. Only these justify back-dating section age to
// `added_on`; anywhere else the honest answer is "no earlier than today".
const BIRTH_STAGES = new Set(["backlog"]);

// Normalise incompatible board vocabularies onto one scale.
//
// `Study/Reading` runs Backlog / In Progress / Quiz / Done, `Work` runs its own
// set, and several projects have no sections at all. Without this, "how much
// work is in review" cannot be asked across projects.
//
// `Quiz` folds into `review` — it is Study/Reading's verification step, the same
// role review plays elsewhere.
//
// Anything unrecognised returns `other`, which is the RENAME TRIPWIRE: a section
// renamed in Todoist shows up as a growing `other` bucket instead of silently
// vanishing from every chart.
export function workStageOf(sectionName: unknown): string {
	const name = String(sectionName ?? "")
		.trim()
		.toLowerCase();
	if (!name) return ""; // no sections — not a stage, an absence
	if (/^(backlog|to ?do|ideas|inbox|new)$/.test(name)) return "backlog";
	if (/^(in progress|doing|active|wip|in development)$/.test(name))
		return "active";
	if (/^(in review|review|quiz|qa|testing|verification)$/.test(name))
		return "review";
	if (/^(done|complete|completed|shipped|closed)$/.test(name))
		return "done";
	if (/^(blocked|waiting|on hold|paused)$/.test(name)) return "blocked";
	if (/^(canceled|cancelled|dropped|abandoned|won'?t do)$/.test(name))
		return "canceled";
	return "other";
}

export interface PriorTaskRow {
	readonly row: Row;
	readonly sectionName: string;
	readonly sectionEnteredOn: string;
	readonly sectionAgeSeeded: boolean;
}

export interface SectionAge {
	readonly enteredOn: DayKey;
	// TRUE when the date is a FLOOR rather than something we watched happen.
	readonly seeded: boolean;
}

// The four cases.
export function sectionAgeFor(
	prior: PriorTaskRow | undefined,
	sectionName: string,
	stage: string,
	addedOn: string,
	today: DayKey,
): SectionAge {
	if (prior) {
		if (prior.sectionName === sectionName) {
			// Same section as yesterday — carry the date, and carry the seeded
			// flag with it. A FLOOR STAYS A FLOOR for the life of the task:
			// dropping the flag on day two would turn a guess into a claim.
			return {
				enteredOn: prior.sectionEnteredOn || today,
				seeded: prior.sectionAgeSeeded,
			};
		}
		// An observed move: we watched it happen, so the date is exact.
		return { enteredOn: today, seeded: false };
	}

	// First time we have ever seen this task.
	if (BIRTH_STAGES.has(stage) && addedOn) {
		// A task starts life in a birth section, so its section age is its age.
		return { enteredOn: addedOn, seeded: true };
	}

	// It was already somewhere else when we first looked. Today is a FLOOR — the
	// true date is unknowable and could be months earlier.
	return { enteredOn: today, seeded: true };
}

// The last snapshot day STRICTLY BEFORE `today`, as task_id → prior fields.
//
// Both conditions matter and both fail silently:
//   * strictly before, so a re-run does not read its own rows and reset every
//     section age to zero;
//   * exit rows excluded, or a departed task is resurrected as a fresh exit row
//     every night, for ever.
export function readPriorTaskState(
	existingRows: readonly Row[],
	today: DayKey,
): Map<string, PriorTaskRow> {
	let latestDay = "";
	for (const row of existingRows.slice(1)) {
		const day = cellValueToDayKey(row[SNAPSHOT_DATE]);
		if (day && day < today && day > latestDay) latestDay = day;
	}

	const prior = new Map<string, PriorTaskRow>();
	if (!latestDay) return prior;

	for (const row of existingRows.slice(1)) {
		if (cellValueToDayKey(row[SNAPSHOT_DATE]) !== latestDay)
			continue;
		if (String(row[IS_EXIT] ?? "").toUpperCase() === "TRUE")
			continue;

		prior.set(String(row[TASK_ID] ?? ""), {
			row,
			sectionName: String(row[SECTION_NAME] ?? ""),
			sectionEnteredOn: cellValueToDayKey(
				row[SECTION_ENTERED_ON],
			),
			sectionAgeSeeded:
				String(
					row[SECTION_AGE_SEEDED] ?? "",
				).toUpperCase() === "TRUE",
		});
	}
	return prior;
}

export interface TaskDailySnapshot {
	readonly openTasks: readonly TodoistTask[];
	readonly existingRows: readonly Row[];
	readonly projectTree: ProjectTree;
	readonly sectionNamesById: Readonly<Record<string, string>>;
	readonly areaMap: AreaMap;
}

// Todoist sends `added_at`; some payloads have used `addedAt`.
function addedOnOf(task: TodoistTask): string {
	const record = task as unknown as Record<string, unknown>;
	return String(record["added_at"] ?? record["addedAt"] ?? "").slice(
		0,
		10,
	);
}

function deadlineOf(task: TodoistTask): string {
	const record = task as unknown as {
		deadline?: { date?: string } | null;
	};
	return String(record.deadline?.date ?? "").slice(0, 10);
}

export function buildTaskDailyRows(
	snapshot: TaskDailySnapshot,
	today: DayKey,
): Row[] {
	const prior = readPriorTaskState(snapshot.existingRows, today);
	const rows: Row[] = [];
	const seen = new Set<string>();

	for (const task of snapshot.openTasks) {
		const id = String(task.id ?? "");
		seen.add(id);

		const projectId = String(task.project_id ?? "");
		const resolved = resolveArea(
			projectId,
			task.labels,
			snapshot.projectTree,
			snapshot.areaMap,
		);
		const sectionName =
			task.section_id === undefined ||
			task.section_id === null
				? ""
				: (snapshot.sectionNamesById[
						String(task.section_id)
					] ?? "");
		const stage = workStageOf(sectionName);
		const addedOn = addedOnOf(task);
		const due = String(task.due?.date ?? "").slice(0, 10);
		const age = sectionAgeFor(
			prior.get(id),
			sectionName,
			stage,
			addedOn,
			today,
		);
		const overdue = due ? daysBetweenDays(due, today) : null;

		rows.push([
			today,
			id,
			task.content ?? "",
			snapshot.projectTree[projectId]?.name ?? "",
			resolved.area,
			resolved.source,
			isInWeek(projectId, snapshot.areaMap)
				? "TRUE"
				: "FALSE",
			sectionName,
			stage,
			(task.labels ?? []).join(","),
			task.priority ?? 1,
			due,
			deadlineOf(task),
			task.due?.is_recurring === true ? "TRUE" : "FALSE",
			task.parent_id ? "TRUE" : "FALSE",
			addedOn,
			addedOn ? (daysBetweenDays(addedOn, today) ?? "") : "",
			age.enteredOn,
			age.enteredOn
				? (daysBetweenDays(age.enteredOn, today) ?? "")
				: "",
			age.seeded ? "TRUE" : "FALSE",
			// Blank unless actually overdue, so the column sums as "lateness"
			// rather than counting every task that is merely due.
			overdue !== null && overdue > 0 ? overdue : "",
			"FALSE",
		]);
	}

	// EXIT ROWS: present in the prior snapshot, absent now. `prior` already
	// excludes earlier exit rows, so a task exits exactly once.
	for (const [id, priorRow] of prior) {
		if (seen.has(id)) continue;
		const carried = [...priorRow.row] as CellValue[];
		rows.push([
			today,
			id,
			...carried.slice(2, 16),
			// Ages keep accruing against the prior dates, so the terminal row
			// records how long the task had been there when it left.
			priorRow.row[15]
				? (daysBetweenDays(
						String(priorRow.row[15]),
						today,
					) ?? "")
				: "",
			priorRow.sectionEnteredOn,
			priorRow.sectionEnteredOn
				? (daysBetweenDays(
						priorRow.sectionEnteredOn,
						today,
					) ?? "")
				: "",
			priorRow.sectionAgeSeeded ? "TRUE" : "FALSE",
			"", // an exited task is not overdue; it is gone
			"TRUE",
		]);
	}

	return rows;
}

export function planTaskDaily(
	snapshot: TaskDailySnapshot,
	tab: string,
	today: DayKey,
): WritePlan {
	const rows = buildTaskDailyRows(snapshot, today);
	const exits = rows.filter((row) => row[IS_EXIT] === "TRUE").length;

	return {
		writes: [
			replaceWhere(
				tab,
				SNAPSHOT_DATE,
				{ onOrAfter: today },
				rows,
			),
		],
		stateToPersist: {},
		logLines: [
			`TaskDaily: ${rows.length} row(s) for ${today} ` +
				`(${rows.length - exits} open, ${exits} exit)`,
		],
	};
}
