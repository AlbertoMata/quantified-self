// D6–D9 — the derived tabs. These read what the fetch pipelines wrote rather
// than Todoist, so the fixtures here are SHEET ROWS, not API payloads.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { AreaMap, ProjectTree } from "../core/areas.ts";
import type { Row } from "../ports/values.ts";
import type { TodoistTask } from "../services/todoist/responses.ts";
import {
	AREA_DAILY_HEADER,
	buildAreaDailyRows,
	planAreaDaily,
} from "./area-daily.ts";
import {
	BILL_CYCLE_HEADER,
	buildBillCycleRows,
	planBillCycle,
} from "./bill-cycle.ts";
import { COMPLETIONS_HEADER } from "./completions.ts";
import {
	HABIT_DAILY_HEADER,
	planHabitDaily,
	readStreakSeeds,
} from "./habit-daily.ts";
import { RECURRING_STATUS_HEADER } from "./recurring-status.ts";
import {
	buildTaskDailyRows,
	planTaskDaily,
	readPriorTaskState,
	sectionAgeFor,
	TASK_DAILY_HEADER,
	workStageOf,
} from "./task-daily.ts";

const TODAY = "2026-09-14"; // a Monday
const TIMEZONE = "America/Mexico_City";

const AREA_MAP: AreaMap = {
	byParentId: { "bills-parent": "bills-taxes", "work-parent": "work" },
	byProjectId: { habits: "habits", week: "errands" },
	order: ["bills-taxes", "work", "habits", "errands"],
	weekProjectId: "week",
};

const TREE: ProjectTree = {
	"bills-parent": { name: "💰 Bills & Taxes", parentId: "" },
	"work-parent": { name: "💼 Work", parentId: "" },
	mortgage: { name: "Mortgage", parentId: "bills-parent" },
	work: { name: "Work", parentId: "work-parent" },
	habits: { name: "Habits", parentId: "" },
	week: { name: "Week", parentId: "" },
};

// A Completions row, positionally, with only the columns these tabs read.
function completionRow(fields: {
	completedAt: string | Date;
	taskId: string;
	content?: string;
	projectId?: string;
	projectName?: string;
	labels?: string;
	isRecurring?: string;
	dueDate?: string;
	area?: string;
	wasOverdue?: string;
}): Row {
	const row: Row = new Array(COMPLETIONS_HEADER.length).fill("");
	const cells = [...row];
	cells[0] = fields.completedAt;
	cells[1] = fields.taskId;
	cells[2] = fields.content ?? "";
	cells[3] = fields.projectId ?? "";
	cells[4] = fields.projectName ?? "";
	cells[6] = fields.labels ?? "";
	cells[8] = fields.isRecurring ?? "FALSE";
	cells[9] = fields.dueDate ?? "";
	cells[14] = fields.area ?? "";
	cells[16] = fields.wasOverdue ?? "";
	return cells;
}

// ── D6: BillCycle ────────────────────────────────────────────────────────────

test("a closed cycle comes from Completions and an open one from the live list", () => {
	const { rows } = buildBillCycleRows(
		{
			completionRows: [
				COMPLETIONS_HEADER,
				completionRow({
					completedAt: "2026-08-02T15:00:00Z",
					taskId: "bill1",
					content: "PAY THE MORTGAGE",
					projectId: "mortgage",
					projectName: "Mortgage",
					dueDate: "2026-08-02",
					area: "bills-taxes",
					wasOverdue: "TRUE",
					isRecurring: "TRUE",
				}),
			],
			liveTasks: [
				{
					id: "bill1",
					content: "PAY THE MORTGAGE",
					project_id: "mortgage",
					due: {
						date: "2026-09-02",
						is_recurring: true,
					},
				},
			],
			projectTree: TREE,
			areaMap: AREA_MAP,
			timezone: TIMEZONE,
		},
		TODAY,
	);

	assert.equal(rows.length, 2);
	assert.equal(
		rows[0]?.[5],
		"2026-08-02",
		"the closed cycle comes first",
	);
	assert.equal(rows[0]?.[8], "closed_late", "was_overdue TRUE wins");
	assert.equal(rows[1]?.[5], "2026-09-02");
	assert.equal(rows[1]?.[8], "overdue", "past due and still unticked");
});

test("a bill renamed in Todoist shows its CURRENT name on historical cycles", () => {
	const { rows } = buildBillCycleRows(
		{
			completionRows: [
				COMPLETIONS_HEADER,
				completionRow({
					completedAt: "2026-08-02T15:00:00Z",
					taskId: "bill1",
					content: "Old name",
					projectId: "mortgage",
					dueDate: "2026-08-02",
					area: "bills-taxes",
				}),
			],
			liveTasks: [
				{
					id: "bill1",
					content: "New name",
					project_id: "mortgage",
				},
			],
			projectTree: TREE,
			areaMap: AREA_MAP,
			timezone: TIMEZONE,
		},
		TODAY,
	);
	assert.equal(rows[0]?.[0], "New name");
});

test("a re-completed cycle keeps the EARLIEST close", () => {
	// A cycle can appear twice if it was un-completed and re-completed. The first
	// close is the one that answers "did this cycle close on time".
	const { rows } = buildBillCycleRows(
		{
			completionRows: [
				COMPLETIONS_HEADER,
				completionRow({
					completedAt: "2026-09-01T15:00:00Z",
					taskId: "bill1",
					projectId: "mortgage",
					dueDate: "2026-09-02",
					area: "bills-taxes",
				}),
				completionRow({
					completedAt: "2026-09-09T15:00:00Z",
					taskId: "bill1",
					projectId: "mortgage",
					dueDate: "2026-09-02",
					area: "bills-taxes",
				}),
			],
			liveTasks: [],
			projectTree: TREE,
			areaMap: AREA_MAP,
			timezone: TIMEZONE,
		},
		TODAY,
	);
	assert.equal(rows.length, 1);
	assert.equal(rows[0]?.[6], "2026-09-01", "the earliest close is kept");
	assert.equal(rows[0]?.[8], "closed");
});

test("a bills completion with no due date is skipped and COUNTED", () => {
	// It cannot be attributed to a cycle. Counted, not guessed at.
	const { rows, skippedWithoutDueDate } = buildBillCycleRows(
		{
			completionRows: [
				COMPLETIONS_HEADER,
				completionRow({
					completedAt: "2026-09-01T15:00:00Z",
					taskId: "bill1",
					projectId: "mortgage",
					area: "bills-taxes",
				}),
			],
			liveTasks: [],
			projectTree: TREE,
			areaMap: AREA_MAP,
			timezone: TIMEZONE,
		},
		TODAY,
	);
	assert.deepEqual(rows, []);
	assert.equal(skippedWithoutDueDate, 1);
});

test("non-bill completions are ignored entirely", () => {
	const { rows } = buildBillCycleRows(
		{
			completionRows: [
				COMPLETIONS_HEADER,
				completionRow({
					completedAt: "2026-09-01T15:00:00Z",
					taskId: "t1",
					projectId: "work",
					dueDate: "2026-09-01",
					area: "work",
				}),
			],
			liveTasks: [],
			projectTree: TREE,
			areaMap: AREA_MAP,
			timezone: TIMEZONE,
		},
		TODAY,
	);
	assert.deepEqual(rows, []);
});

test("BillCycle is a FULL rebuild", () => {
	// Every row is recomputed nightly, which is the case that made Match need
	// an `all` variant.
	const plan = planBillCycle(
		{
			completionRows: [COMPLETIONS_HEADER],
			liveTasks: [],
			projectTree: TREE,
			areaMap: AREA_MAP,
			timezone: TIMEZONE,
		},
		"BillCycle_port",
		TODAY,
	);
	const [write] = plan.writes;
	assert.ok(write && write.mode === "replaceWhere");
	assert.deepEqual(write.match, { all: true });
	assert.equal(BILL_CYCLE_HEADER.length, 12);
});

// ── D7: AreaDaily ────────────────────────────────────────────────────────────

function areaSnapshot(openTasks: TodoistTask[], completions: Row[] = []) {
	return {
		openTasks,
		completionRows: [COMPLETIONS_HEADER, ...completions],
		projectTree: TREE,
		areaMap: AREA_MAP,
		timezone: TIMEZONE,
	};
}

test("every area gets a row every day, including uncategorized", () => {
	// A rising uncategorized line means the taxonomy is drifting, so it is a
	// metric in its own right rather than a bucket to hide.
	const rows = buildAreaDailyRows(areaSnapshot([]), TODAY);
	assert.deepEqual(
		rows.map((row) => row[1]),
		["bills-taxes", "work", "habits", "errands", "uncategorized"],
	);
	assert.equal(rows.length, AREA_MAP.order.length + 1);
	assert.equal(AREA_DAILY_HEADER.length, 8);
});

test("priority 4 is p1 — the API scale runs opposite to the UI label", () => {
	// An easy off-by-three: the UI says p1 is highest, the wire says 4.
	const rows = buildAreaDailyRows(
		areaSnapshot([
			{ id: "1", project_id: "work", priority: 4 },
			{ id: "2", project_id: "work", priority: 1 },
		]),
		TODAY,
	);
	const work = rows.find((row) => row[1] === "work");
	assert.equal(work?.[2], 2, "open");
	assert.equal(work?.[5], 1, "p1_open counts only priority 4");
});

test("overdue counts only tasks actually past due", () => {
	const rows = buildAreaDailyRows(
		areaSnapshot([
			{
				id: "1",
				project_id: "work",
				due: { date: "2026-09-10" },
			},
			{ id: "2", project_id: "work", due: { date: TODAY } },
			{
				id: "3",
				project_id: "work",
				due: { date: "2026-09-20" },
			},
			{ id: "4", project_id: "work" },
		]),
		TODAY,
	);
	const work = rows.find((row) => row[1] === "work");
	assert.equal(work?.[2], 4, "all four are open");
	assert.equal(work?.[3], 1, "only the one past due is overdue");
});

test("in_week is orthogonal — a bill in the week is still a bill", () => {
	const rows = buildAreaDailyRows(
		areaSnapshot([
			{
				id: "1",
				project_id: "week",
				labels: ["area-bills-taxes"],
			},
		]),
		TODAY,
	);
	const bills = rows.find((row) => row[1] === "bills-taxes");
	assert.equal(bills?.[2], 1, "counted under bills");
	assert.equal(bills?.[4], 1, "and flagged as in the week");
});

test("completed comes from Completions, on the LOCAL day", () => {
	// 02:00Z on the 15th is 20:00 on the 14th in Mexico City.
	const rows = buildAreaDailyRows(
		areaSnapshot(
			[],
			[
				completionRow({
					completedAt: "2026-09-15T02:00:00Z",
					taskId: "t1",
					projectId: "work",
					area: "work",
				}),
			],
		),
		TODAY,
	);
	assert.equal(rows.find((row) => row[1] === "work")?.[6], 1);
});

test("counts_observed is TRUE, because these counts were just measured", () => {
	// The column exists so a backfilled row is never averaged in as though it
	// had been observed. Snapshot columns cannot be rebuilt for a past day.
	const rows = buildAreaDailyRows(areaSnapshot([]), TODAY);
	assert.ok(rows.every((row) => row[7] === "TRUE"));
});

test("AreaDaily clears today AND anything later", () => {
	// So a row written under a wrong future date cannot linger for ever.
	const plan = planAreaDaily(areaSnapshot([]), "AreaDaily_port", TODAY);
	const [write] = plan.writes;
	assert.ok(write && write.mode === "replaceWhere");
	assert.deepEqual(write.match, { onOrAfter: TODAY });
});

// ── D8: TaskDaily ────────────────────────────────────────────────────────────

test("work stages normalise incompatible vocabularies", () => {
	assert.equal(workStageOf("Backlog"), "backlog");
	assert.equal(workStageOf("In Progress"), "active");
	assert.equal(workStageOf("In Review"), "review");
	assert.equal(
		workStageOf("Quiz"),
		"review",
		"Study/Reading's verification step",
	);
	assert.equal(workStageOf("Done"), "done");
	assert.equal(
		workStageOf(""),
		"",
		"no sections is an absence, not a stage",
	);
});

test("an unrecognised section becomes `other` — the RENAME TRIPWIRE", () => {
	// A renamed section shows up as a growing `other` bucket rather than
	// silently vanishing from every chart.
	assert.equal(workStageOf("Marinating"), "other");
});

test("a first sighting in a birth section back-dates the age", () => {
	const age = sectionAgeFor(
		undefined,
		"Backlog",
		"backlog",
		"2026-09-01",
		TODAY,
	);
	assert.deepEqual(age, { enteredOn: "2026-09-01", seeded: true });
});

test("a first sighting anywhere else makes TODAY a floor", () => {
	// The true date is unknowable and could be months earlier, so the honest
	// answer is "no earlier than today" — flagged as seeded.
	const age = sectionAgeFor(
		undefined,
		"In Review",
		"review",
		"2026-09-01",
		TODAY,
	);
	assert.deepEqual(age, { enteredOn: TODAY, seeded: true });
});

test("a floor STAYS a floor for the life of the task", () => {
	// Dropping the flag on day two would turn a guess into a claim.
	const age = sectionAgeFor(
		{
			row: [],
			sectionName: "In Review",
			sectionEnteredOn: "2026-09-10",
			sectionAgeSeeded: true,
		},
		"In Review",
		"review",
		"2026-09-01",
		TODAY,
	);
	assert.deepEqual(age, { enteredOn: "2026-09-10", seeded: true });
});

test("an OBSERVED move is exact, not seeded", () => {
	const age = sectionAgeFor(
		{
			row: [],
			sectionName: "Backlog",
			sectionEnteredOn: "2026-09-01",
			sectionAgeSeeded: true,
		},
		"In Review",
		"review",
		"2026-09-01",
		TODAY,
	);
	assert.deepEqual(age, { enteredOn: TODAY, seeded: false });
});

function taskDailyRow(fields: {
	day: string;
	taskId: string;
	sectionName?: string;
	enteredOn?: string;
	seeded?: string;
	isExit?: string;
}): Row {
	const cells: Row = new Array(TASK_DAILY_HEADER.length).fill("");
	const row = [...cells];
	row[0] = fields.day;
	row[1] = fields.taskId;
	row[7] = fields.sectionName ?? "";
	row[15] = "2026-09-01";
	row[17] = fields.enteredOn ?? "";
	row[19] = fields.seeded ?? "FALSE";
	row[21] = fields.isExit ?? "FALSE";
	return row;
}

test("prior state comes from the last day STRICTLY BEFORE today", () => {
	// Otherwise an hourly re-run reads its own half-written rows and resets
	// every section age to zero.
	const prior = readPriorTaskState(
		[
			TASK_DAILY_HEADER,
			taskDailyRow({
				day: "2026-09-12",
				taskId: "a",
				enteredOn: "2026-09-12",
			}),
			taskDailyRow({
				day: "2026-09-13",
				taskId: "a",
				enteredOn: "2026-09-12",
			}),
			taskDailyRow({
				day: TODAY,
				taskId: "a",
				enteredOn: TODAY,
			}),
		],
		TODAY,
	);
	assert.equal(prior.get("a")?.sectionEnteredOn, "2026-09-12");
});

test("exit rows are excluded from prior state", () => {
	// Or a task that left last week is resurrected as a fresh exit row every
	// single night, for ever.
	const prior = readPriorTaskState(
		[
			TASK_DAILY_HEADER,
			taskDailyRow({
				day: "2026-09-13",
				taskId: "gone",
				isExit: "TRUE",
			}),
			taskDailyRow({ day: "2026-09-13", taskId: "here" }),
		],
		TODAY,
	);
	assert.equal(prior.has("gone"), false);
	assert.equal(prior.has("here"), true);
});

test("a task present yesterday and absent today gets ONE exit row", () => {
	const rows = buildTaskDailyRows(
		{
			openTasks: [],
			existingRows: [
				TASK_DAILY_HEADER,
				taskDailyRow({
					day: "2026-09-13",
					taskId: "gone",
					sectionName: "In Review",
					enteredOn: "2026-09-10",
					seeded: "TRUE",
				}),
			],
			projectTree: TREE,
			sectionNamesById: {},
			areaMap: AREA_MAP,
		},
		TODAY,
	);
	assert.equal(rows.length, 1);
	assert.equal(rows[0]?.[21], "TRUE", "is_exit");
	assert.equal(
		rows[0]?.[20],
		"",
		"an exited task is not overdue; it is gone",
	);
	assert.equal(
		rows[0]?.[17],
		"2026-09-10",
		"its section date is carried",
	);
	assert.equal(rows[0]?.[18], 4, "and the age keeps accruing to today");
});

test("days_overdue is blank unless actually overdue", () => {
	// So the column sums as lateness rather than counting everything merely due.
	const rows = buildTaskDailyRows(
		{
			openTasks: [
				{
					id: "late",
					project_id: "work",
					due: { date: "2026-09-10" },
				},
				{
					id: "today",
					project_id: "work",
					due: { date: TODAY },
				},
			],
			existingRows: [TASK_DAILY_HEADER],
			projectTree: TREE,
			sectionNamesById: {},
			areaMap: AREA_MAP,
		},
		TODAY,
	);
	assert.equal(rows.find((row) => row[1] === "late")?.[20], 4);
	assert.equal(rows.find((row) => row[1] === "today")?.[20], "");
});

test("TaskDaily clears today and later, and reports its exits", () => {
	const plan = planTaskDaily(
		{
			openTasks: [{ id: "a", project_id: "work" }],
			existingRows: [TASK_DAILY_HEADER],
			projectTree: TREE,
			sectionNamesById: {},
			areaMap: AREA_MAP,
		},
		"TaskDaily_port",
		TODAY,
	);
	const [write] = plan.writes;
	assert.ok(write && write.mode === "replaceWhere");
	assert.deepEqual(write.match, { onOrAfter: TODAY });
	assert.match(plan.logLines[0] ?? "", /1 open, 0 exit/);
});

// ── D9: HabitDaily ───────────────────────────────────────────────────────────

function spineRow(
	day: string,
	taskId: string,
	content = "Drink Water - daily",
): Row {
	const cells: Row = new Array(RECURRING_STATUS_HEADER.length).fill("");
	const row = [...cells];
	row[0] = day;
	row[1] = taskId;
	row[2] = content;
	row[5] = "habits";
	row[6] = 1;
	row[7] = "2026-09-15";
	row[8] = "every day at 6:00 am";
	return row;
}

function habitCompletion(completedAt: string, taskId: string): Row {
	return completionRow({
		completedAt,
		taskId,
		labels: "habits",
		isRecurring: "TRUE",
	});
}

test("HabitDaily writes NOTHING when the spine is missing", () => {
	// Writing anything would clear the grid and refill it with nothing.
	const plan = planHabitDaily(
		{
			spineRows: [RECURRING_STATUS_HEADER],
			completionRows: [COMPLETIONS_HEADER],
			existingRows: [HABIT_DAILY_HEADER],
			timezone: TIMEZONE,
		},
		"HabitDaily_port",
		TODAY,
	);
	assert.deepEqual(plan.writes, []);
	assert.match(plan.logLines[0] ?? "", /no RecurringStatus rows/);
});

test("a completed day is done and an owed weekday with nothing is missed", () => {
	const plan = planHabitDaily(
		{
			spineRows: [
				RECURRING_STATUS_HEADER,
				spineRow("2026-09-10", "h1"),
				spineRow("2026-09-11", "h1"),
			],
			completionRows: [
				COMPLETIONS_HEADER,
				habitCompletion("2026-09-10T13:22:00Z", "h1"),
			],
			existingRows: [HABIT_DAILY_HEADER],
			timezone: TIMEZONE,
		},
		"HabitDaily_port",
		TODAY,
	);
	const [write] = plan.writes;
	assert.ok(write && write.mode === "replaceWhere");
	assert.equal(write.rows[0]?.[6], "done");
	assert.equal(write.rows[0]?.[7], 1, "completed");
	assert.equal(
		write.rows[0]?.[9],
		"07:22",
		"the local clock time is kept",
	);
	assert.equal(write.rows[1]?.[6], "missed");
});

test("a rest-day check-off still counts as due, so it can score", () => {
	// `due` is 1 for everything except not_due — which keeps a weekend
	// completion visible rather than discarding it.
	const plan = planHabitDaily(
		{
			spineRows: [
				RECURRING_STATUS_HEADER,
				spineRow("2026-09-12", "h1"),
			], // Saturday
			completionRows: [
				COMPLETIONS_HEADER,
				habitCompletion("2026-09-12T13:00:00Z", "h1"),
			],
			existingRows: [HABIT_DAILY_HEADER],
			timezone: TIMEZONE,
		},
		"HabitDaily_port",
		TODAY,
	);
	const [write] = plan.writes;
	assert.ok(write && write.mode === "replaceWhere");
	assert.equal(write.rows[0]?.[6], "done");
	assert.equal(write.rows[0]?.[8], 1, "due");
});

test("a skipped weekend does not break the streak", () => {
	const plan = planHabitDaily(
		{
			spineRows: [
				RECURRING_STATUS_HEADER,
				spineRow("2026-09-11", "h1"), // Friday
				spineRow("2026-09-12", "h1"), // Saturday
				spineRow("2026-09-13", "h1"), // Sunday
				spineRow(TODAY, "h1"), // Monday
			],
			completionRows: [
				COMPLETIONS_HEADER,
				habitCompletion("2026-09-11T13:00:00Z", "h1"),
				habitCompletion("2026-09-14T13:00:00Z", "h1"),
			],
			existingRows: [HABIT_DAILY_HEADER],
			timezone: TIMEZONE,
		},
		"HabitDaily_port",
		TODAY,
	);
	const [write] = plan.writes;
	assert.ok(write && write.mode === "replaceWhere");
	assert.deepEqual(
		write.rows.map((row) => row[15]),
		[1, 1, 1, 2],
		"the weekend carries the streak rather than breaking it",
	);
});

test("streak seeds continue from below the replace boundary", () => {
	// What keeps a nightly 7-day window and a 400-day backfill in agreement.
	const seeds = readStreakSeeds(
		[
			HABIT_DAILY_HEADER,
			[
				"2026-09-01",
				"h1",
				...new Array(13).fill(""),
				7,
			] as unknown as Row,
			[
				"2026-09-05",
				"h1",
				...new Array(13).fill(""),
				11,
			] as unknown as Row,
			[
				"2026-09-20",
				"h1",
				...new Array(13).fill(""),
				99,
			] as unknown as Row,
		],
		"2026-09-10",
	);
	assert.equal(
		seeds.get("h1"),
		11,
		"the newest row BELOW the cutoff wins",
	);
});

test("the replace boundary never reaches below the observed spine", () => {
	// A 400-day cutoff would otherwise DELETE synthesised pre-spine rows while
	// writing nothing in their place.
	const plan = planHabitDaily(
		{
			spineRows: [
				RECURRING_STATUS_HEADER,
				spineRow("2026-09-10", "h1"),
			],
			completionRows: [COMPLETIONS_HEADER],
			existingRows: [
				HABIT_DAILY_HEADER,
				spineRow("2026-01-01", "h1"),
			],
			timezone: TIMEZONE,
		},
		"HabitDaily_port",
		TODAY,
		{ windowDays: 400 },
	);
	const [write] = plan.writes;
	assert.ok(write && write.mode === "replaceWhere");
	assert.deepEqual(
		write.match,
		{ onOrAfter: "2026-09-10" },
		"clamped to the earliest spine day, not the 400-day cutoff",
	);
});

test("an EMPTY tab widens the window to a full backfill", () => {
	// Without this the first run after a layout change clears the whole grid and
	// refills only a week.
	const plan = planHabitDaily(
		{
			spineRows: [
				RECURRING_STATUS_HEADER,
				spineRow("2026-01-15", "h1"),
			],
			completionRows: [COMPLETIONS_HEADER],
			existingRows: [HABIT_DAILY_HEADER],
			timezone: TIMEZONE,
		},
		"HabitDaily_port",
		TODAY,
		{ windowDays: 7 },
	);
	const [write] = plan.writes;
	assert.ok(write && write.mode === "replaceWhere");
	assert.equal(write.rows.length, 1, "a January spine row is in range");
	assert.match(plan.logLines[0] ?? "", /auto-backfill/);
});

test("only habit-labelled spine rows reach the grid", () => {
	const notAHabit = spineRow("2026-09-11", "t1");
	const cells = [...notAHabit];
	cells[5] = "work";
	const plan = planHabitDaily(
		{
			spineRows: [RECURRING_STATUS_HEADER, cells],
			completionRows: [COMPLETIONS_HEADER],
			existingRows: [
				HABIT_DAILY_HEADER,
				spineRow("2026-09-01", "h1"),
			],
			timezone: TIMEZONE,
		},
		"HabitDaily_port",
		TODAY,
	);
	const [write] = plan.writes;
	assert.ok(write && write.mode === "replaceWhere");
	assert.deepEqual(write.rows, []);
});

test("the short habit name is split out, and the full one kept", () => {
	const plan = planHabitDaily(
		{
			spineRows: [
				RECURRING_STATUS_HEADER,
				spineRow(
					"2026-09-11",
					"h1",
					"Drink Water - early in the morning",
				),
			],
			completionRows: [COMPLETIONS_HEADER],
			existingRows: [HABIT_DAILY_HEADER],
			timezone: TIMEZONE,
		},
		"HabitDaily_port",
		TODAY,
	);
	const [write] = plan.writes;
	assert.ok(write && write.mode === "replaceWhere");
	assert.equal(write.rows[0]?.[2], "Drink Water");
	assert.equal(write.rows[0]?.[3], "Drink Water - early in the morning");
	assert.equal(
		write.rows[0]?.[14],
		"06:00",
		"due_time parsed from the rule",
	);
});
