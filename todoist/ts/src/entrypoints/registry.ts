// ─────────────────────────────────────────────────────────────────────────────
// The entry-point registry — one array, three readers
//
// Today ~30 callable functions are scattered across the ten legacy .gs files
// with no index anywhere: three are on time triggers, the rest are backfills,
// repairs and diagnostics that you have to go and find. This array replaces
// that with a list, and three things read it so none of them can drift:
//
//   1. scripts/build.mjs generates the Apps Script globals from it. Adding an
//      entry here is what makes a function callable in the editor — nothing
//      else exposes a global.
//   2. The Node CLI dispatches on it (F3), so both runtimes expose the same set.
//   3. ENTRYPOINTS.md is generated from it, and a test asserts they match.
//
// ⚠️ THE `port` PREFIX IS LOAD-BEARING UNTIL E4. The port develops inside the
// production Apps Script project, where every file shares ONE flat global
// scope, and all eleven names this port eventually wants — syncTodoist,
// syncOverdue, and the rest — already exist there as legacy globals. Two
// definitions of syncTodoist is not an error: the last one concatenated wins,
// silently, and the nightly trigger runs whichever that happens to be.
//
// So the generated global is always `port` + the capitalised name, and the
// prefix is applied by the build rather than typed by hand. Dropping it is a
// one-line change at E4, once the legacy triggers are off.
// ─────────────────────────────────────────────────────────────────────────────

import { applyWritePlan } from "../core/apply-write-plan.ts";
import { formatDayInTimezone } from "../core/dates.ts";
import { appendTo, type WritePlan } from "../core/write-plan.ts";
import { readSetting, requireSetting } from "../config.ts";
import {
	COMPLETIONS_HEADER,
	parseInReviewIds,
	planCompletions,
	PORT_IN_REVIEW_PREV_KEY,
	PORT_LAST_SYNC_KEY,
	type CompletionEvent,
} from "../pipelines/completions.ts";
import { resolveCompletionsWindow } from "../pipelines/completions-window.ts";
import {
	KARMA_STATS_HEADER,
	planKarmaStats,
	type TodoistStats,
} from "../pipelines/karma-stats.ts";
import { AREA_DAILY_HEADER, planAreaDaily } from "../pipelines/area-daily.ts";
import { BILL_CYCLE_HEADER, planBillCycle } from "../pipelines/bill-cycle.ts";
import {
	HABIT_DAILY_HEADER,
	planHabitDaily,
} from "../pipelines/habit-daily.ts";
import { OVERDUE_HEADER, planOverdue } from "../pipelines/overdue.ts";
import {
	HABIT_SECTIONS,
	HABITS_PROJECT_NAME,
	planHabitReschedule,
	type UpdateCommand,
} from "../pipelines/reschedule-habits.ts";
import { planTaskDaily, TASK_DAILY_HEADER } from "../pipelines/task-daily.ts";
import {
	planRecurringStatus,
	RECURRING_STATUS_HEADER,
} from "../pipelines/recurring-status.ts";
import type { Runtime } from "../ports/index.ts";
import type { Row } from "../ports/values.ts";
import { fetchAllTodoistPages } from "../services/todoist/fetch-pages.ts";
import {
	AREA_MAP,
	IN_REVIEW_SECTION_NAME,
	IN_REVIEW_TARGET_PROJECTS,
} from "../services/todoist/area-map.ts";
import {
	completionActivitiesRequest,
	inReviewTasksRequest,
	oneOffCompletionsRequest,
	openTasksRequest,
	overdueTasksRequest,
	projectsRequest,
	recurringTasksRequest,
	sectionsRequest,
	sectionTasksRequest,
	TODOIST_API_BASE,
} from "../services/todoist/requests.ts";
import { formatTodoistDateTime } from "../core/dates.ts";
import {
	parseJsonBody,
	toIdNameMap,
	toProjectTree,
	type TodoistProject,
	type TodoistTask,
} from "../services/todoist/responses.ts";

export type EntryPointKind = "trigger" | "manual" | "backfill" | "diagnostic";

// How an entry point was asked to run.
//
// The Apps Script editor's Run button can only call a zero-argument global, so
// "run this without writing anything" cannot be a parameter you type — it has
// to be its own callable. The build generates a second global per writing entry
// point for exactly that, and this is what it passes.
export interface RunOptions {
	readonly dryRun: boolean;
}

export interface EntryPoint {
	// The name this will have AFTER cutover, without the port prefix. The
	// prefix is added by the build, so this file never needs editing at E4.
	readonly name: string;
	readonly kind: EntryPointKind;
	// For triggers, when it runs — in local time, which is what the Apps Script
	// trigger UI speaks. Absent for anything invoked by hand.
	readonly schedule?: string;
	// Tabs it writes. Documentation today; at B4b it is also what the tab-name
	// guard checks a plan against, so keep it honest.
	readonly writes?: readonly string[];
	// ⚠️ Writes something the `_port` shadow scheme CANNOT protect — Todoist
	// itself, or an external service. There is no shadow Todoist, so the tab
	// guards do not apply and a dry run is the only safety net there is.
	// Setting this is what earns an entry point a dry-run twin even when it
	// writes no tab.
	readonly writesExternally?: boolean;
	readonly summary: string;
	readonly run: (runtime: Runtime, options: RunOptions) => void;
}

// The Apps Script global for an entry point. One place, one rule.
export function globalNameFor(entryPoint: { name: string }): string {
	const [first = "", ...rest] = entryPoint.name;
	return `port${first.toUpperCase()}${rest.join("")}`;
}

// The dry-run twin. `portSyncOverdue` writes; `portSyncOverdueDryRun` reports
// exactly what it would have written and touches nothing.
export function dryRunGlobalNameFor(entryPoint: { name: string }): string {
	return `${globalNameFor(entryPoint)}DryRun`;
}

// Only entry points that write get a dry-run twin. A dry run of something that
// writes nothing is noise in a dropdown that will eventually hold ~30 names.
export function hasDryRunVariant(entryPoint: {
	writes?: readonly string[] | undefined;
	writesExternally?: boolean | undefined;
}): boolean {
	return (
		(entryPoint.writes?.length ?? 0) > 0 ||
		entryPoint.writesExternally === true
	);
}

// A smoke test, and deliberately the only entry point in B4.
//
// It exists to prove the whole chain end to end — TypeScript compiles, esbuild
// bundles, the footer exposes a global, clasp pushes it, and the editor can run
// it — while touching nothing. It reads the clock and writes a log line. No
// sheet, no network, no state.
function runPortPing(runtime: Runtime, options: RunOptions): void {
	runtime.logger.log(
		`portPing: the TypeScript bundle is live. Clock says ${runtime.clock.now().toISOString()}.`,
	);
	runtime.logger.log(
		`portPing: dryRun=${options.dryRun}. No tab, property or network call was touched either way.`,
	);
}

// The first entry point that writes anything — and deliberately the smallest
// possible one. It appends a single row to `Ping_port`, creating the tab if it
// is missing, and exercises the whole chain that Phase D will lean on: a pure
// plan, the guards, the applier, the GAS TableStore.
//
// `Ping_port` is a shadow tab, so the B4b guards permit it and no legacy code
// or Looker source reads it. It is safe to delete at any time; the next run
// recreates it.
function runPortPingWrite(runtime: Runtime, options: RunOptions): void {
	const today = runtime.clock.now().toISOString();
	const plan: WritePlan = {
		writes: [
			appendTo(PING_TAB, [
				[today, "portPingWrite", options.dryRun],
			]),
		],
		stateToPersist: { PORT_PING_LAST_RUN: today },
		logLines: [`portPingWrite: one row for ${today}`],
	};

	// ensureTable is outside the plan because a WritePlan describes rows, not
	// schema. It is idempotent, and the guards check it like any other write.
	if (!options.dryRun) {
		runtime.tables.ensureTable(PING_TAB, PING_HEADER);
	}

	applyWritePlan(plan, runtime.tables, runtime.state, runtime.logger, {
		dryRun: options.dryRun,
	});
}

const PING_TAB = "Ping_port";
const PING_HEADER: Row = ["ran_at", "entry_point", "was_dry_run"];

// ── Overdue (D2) ─────────────────────────────────────────────────────────────

const OVERDUE_TAB = "Overdue_port";

// The whole sandwich, in one place: FETCH → pure PLAN → APPLY.
//
// Note how little there is. Every decision — which rows, which days to replace,
// what to log — was made in planOverdue, which is pure and tested against
// fixtures. This function only moves data across the seam, and the same six
// statements will serve every pipeline in Phase D.
function runPortSyncOverdue(runtime: Runtime, options: RunOptions): void {
	const config = readPipelineConfig(runtime);
	const fetchContext = {
		http: runtime.http,
		clock: runtime.clock,
		logger: runtime.logger,
		token: config.todoistToken,
	};

	// FETCH
	const overdueTasks = fetchAllTodoistPages<TodoistTask>(
		fetchContext,
		overdueTasksRequest(),
	);
	const projects = fetchAllTodoistPages<TodoistProject>(
		fetchContext,
		projectsRequest(),
	);

	// PLAN — pure from here to the next comment
	const today = formatDayInTimezone(runtime.clock.now(), config.timezone);
	const plan = planOverdue(
		{ overdueTasks, projectNamesById: toIdNameMap(projects) },
		OVERDUE_TAB,
		today,
	);

	// APPLY
	if (!options.dryRun) {
		runtime.tables.ensureTable(OVERDUE_TAB, OVERDUE_HEADER);
	}
	applyWritePlan(plan, runtime.tables, runtime.state, runtime.logger, {
		dryRun: options.dryRun,
	});
}

// ── RecurringStatus (D3) ─────────────────────────────────────────────────────

const RECURRING_STATUS_TAB = "RecurringStatus_port";

function runPortSyncRecurringStatus(
	runtime: Runtime,
	options: RunOptions,
): void {
	const config = readPipelineConfig(runtime);
	const fetchContext = fetchContextFor(runtime, config.todoistToken);

	const recurringTasks = fetchAllTodoistPages<TodoistTask>(
		fetchContext,
		recurringTasksRequest(),
	);
	const projects = fetchAllTodoistPages<TodoistProject>(
		fetchContext,
		projectsRequest(),
	);
	const sections = fetchAllTodoistPages<TodoistProject>(
		fetchContext,
		sectionsRequest(),
	);

	const today = formatDayInTimezone(runtime.clock.now(), config.timezone);
	const plan = planRecurringStatus(
		{
			recurringTasks,
			projectNamesById: toIdNameMap(projects),
			sectionNamesById: toIdNameMap(sections),
		},
		RECURRING_STATUS_TAB,
		today,
	);

	if (!options.dryRun) {
		runtime.tables.ensureTable(
			RECURRING_STATUS_TAB,
			RECURRING_STATUS_HEADER,
		);
	}
	applyWritePlan(plan, runtime.tables, runtime.state, runtime.logger, {
		dryRun: options.dryRun,
	});
}

// ── KarmaStats (D4) ──────────────────────────────────────────────────────────

const KARMA_STATS_TAB = "KarmaStats_port";

// The stats endpoint MOVED in v1 and which one answers depends on the account,
// so both known candidates are tried and the first that returns JSON wins. The
// legacy code does the same, and the reason is worth keeping: a hard-coded
// endpoint silently returned HTML on some accounts.
const STATS_ENDPOINT_CANDIDATES = ["/tasks/completed/stats", "/user/stats"];

function runPortSyncKarmaStats(runtime: Runtime, options: RunOptions): void {
	const config = readPipelineConfig(runtime);
	const headers = { Authorization: `Bearer ${config.todoistToken}` };

	let stats: TodoistStats | null = null;
	const failures: string[] = [];
	for (const path of STATS_ENDPOINT_CANDIDATES) {
		const response = runtime.http.get(
			`${TODOIST_API_BASE}${path}`,
			headers,
		);
		if (response.status >= 300) {
			failures.push(`${path} → HTTP ${response.status}`);
			continue;
		}
		try {
			stats = parseJsonBody(response.body) as TodoistStats;
			runtime.logger.log(
				`KarmaStats: stats endpoint OK: ${path}`,
			);
			break;
		} catch (error) {
			failures.push(`${path} → ${String(error)}`);
		}
	}
	if (!stats) {
		throw new Error(
			`No working Todoist stats endpoint. Tried: ${failures.join(" | ")}`,
		);
	}

	const today = formatDayInTimezone(runtime.clock.now(), config.timezone);
	const plan = planKarmaStats(
		{
			stats,
			existingRows: runtime.tables.readRows(KARMA_STATS_TAB),
		},
		KARMA_STATS_TAB,
		today,
	);

	if (!options.dryRun) {
		runtime.tables.ensureTable(KARMA_STATS_TAB, KARMA_STATS_HEADER);
	}
	applyWritePlan(plan, runtime.tables, runtime.state, runtime.logger, {
		dryRun: options.dryRun,
	});
}

// ── Completions (D5) ─────────────────────────────────────────────────────────

const COMPLETIONS_TAB = "Completions_port";

function runPortSyncCompletions(runtime: Runtime, options: RunOptions): void {
	const config = readPipelineConfig(runtime);
	const fetchContext = fetchContextFor(runtime, config.todoistToken);

	const existingRows = runtime.tables.readRows(COMPLETIONS_TAB);
	const window = resolveCompletionsWindow(
		// Reads the PORT_ cursor, never the legacy one. On a first run that is
		// absent, so the window falls back to the full 90 days — which is the
		// right answer for an empty shadow tab anyway.
		runtime.state.read(PORT_LAST_SYNC_KEY),
		existingRows.length < 2,
		runtime.clock.now(),
	);
	runtime.logger.log(
		`Completions: window ${formatTodoistDateTime(window.since)} → ` +
			`${formatTodoistDateTime(window.until)} (${window.reason})`,
	);

	const since = formatTodoistDateTime(window.since);
	const until = formatTodoistDateTime(window.until);

	const oneOffCompletions = fetchAllTodoistPages<CompletionEvent>(
		fetchContext,
		oneOffCompletionsRequest(since, until),
	);

	// Only RECURRING check-offs from the activity log — one-off completions come
	// from the endpoint above with fuller data, and the two sets are disjoint by
	// construction, so nothing can arrive twice.
	const activities = fetchAllTodoistPages<ActivityEvent>(
		fetchContext,
		completionActivitiesRequest(since, until),
	);
	const recurringCompletions = activities
		.filter((event) => isRecurringActivity(event))
		.map((event) => normaliseActivityEvent(event));

	const inReviewTasks = fetchAllTodoistPages<CompletionEvent>(
		fetchContext,
		inReviewTasksRequest(
			IN_REVIEW_TARGET_PROJECTS,
			IN_REVIEW_SECTION_NAME,
		),
	);

	const projects = fetchAllTodoistPages<TodoistProject>(
		fetchContext,
		projectsRequest(),
	);
	const sections = fetchAllTodoistPages<TodoistProject>(
		fetchContext,
		sectionsRequest(),
	);

	const plan = planCompletions(
		{
			oneOffCompletions,
			recurringCompletions,
			inReviewTasks,
			previousInReviewIds: parseInReviewIds(
				runtime.state.read(PORT_IN_REVIEW_PREV_KEY),
			),
			existingRows,
			projectNamesById: toIdNameMap(projects),
			sectionNamesById: toIdNameMap(sections),
			projectTree: toProjectTree(projects),
			areaMap: AREA_MAP,
		},
		COMPLETIONS_TAB,
		formatDayInTimezone(runtime.clock.now(), config.timezone),
		window.until,
	);

	if (!options.dryRun) {
		runtime.tables.ensureTable(COMPLETIONS_TAB, COMPLETIONS_HEADER);
	}
	applyWritePlan(plan, runtime.tables, runtime.state, runtime.logger, {
		dryRun: options.dryRun,
	});
}

// An /activities event, before normalisation.
interface ActivityEvent {
	readonly object_id?: string | number;
	readonly event_date?: string;
	readonly parent_project_id?: string | number;
	readonly extra_data?: Record<string, unknown>;
}

function isRecurringActivity(event: ActivityEvent): boolean {
	const extra = event.extra_data ?? {};
	const flag = extra["is_recurring"] ?? extra["isRecurring"];
	return flag === true;
}

// Flatten an activity event into the same shape a completion has.
//
// TWO TRAPS, both verified live and both easy to get wrong:
//   * the PROJECT is at the top level as parent_project_id, NOT in extra_data;
//   * due_date is already the NEXT occurrence — the one that was completed is
//     completed_due_date. Reading due_date would date every recurring
//     completion one cycle into the future.
function normaliseActivityEvent(event: ActivityEvent): CompletionEvent {
	const extra = event.extra_data ?? {};
	const labels = extra["labels"];
	return {
		// `?? ""` rather than passing undefined through: exactOptionalPropertyTypes
		// distinguishes "absent" from "present but undefined", and an event with
		// no object_id is dropped downstream by the id check anyway.
		id: event.object_id ?? "",
		completed_at: event.event_date ?? "",
		content:
			typeof extra["content"] === "string"
				? extra["content"]
				: "",
		project_id: event.parent_project_id ?? "",
		parent_id: (extra["parent_id"] ?? null) as
			| string
			| number
			| null,
		labels: Array.isArray(labels) ? (labels as string[]) : [],
		priority:
			typeof extra["priority"] === "number"
				? extra["priority"]
				: 1,
		due: {
			date:
				typeof extra["completed_due_date"] === "string"
					? extra["completed_due_date"]
					: "",
			is_recurring: true,
		},
		was_overdue:
			typeof extra["was_overdue"] === "boolean"
				? extra["was_overdue"]
				: null,
	};
}

function fetchContextFor(runtime: Runtime, token: string) {
	return {
		http: runtime.http,
		clock: runtime.clock,
		logger: runtime.logger,
		token,
	};
}

// ── The derived tabs (D6–D9) ─────────────────────────────────────────────────
//
// These read the tabs the fetch pipelines wrote rather than Todoist, which is
// why the orchestrator's ordering matters: Completions and RecurringStatus must
// already hold today's rows before any of these run, and HabitDaily must be last
// because it reads BOTH.

const BILL_CYCLE_TAB = "BillCycle_port";
const AREA_DAILY_TAB = "AreaDaily_port";
const TASK_DAILY_TAB = "TaskDaily_port";
const HABIT_DAILY_TAB = "HabitDaily_port";

// The shadow tabs the derived pipelines READ. During the port they read the
// port's own output, not the legacy tabs — otherwise a parity diff would be
// comparing the port's derivation of the legacy data against the legacy's own,
// which tests the derivation but not the pipeline feeding it.
const COMPLETIONS_SOURCE_TAB = "Completions_port";
const RECURRING_STATUS_SOURCE_TAB = "RecurringStatus_port";

function runPortSyncBillCycle(runtime: Runtime, options: RunOptions): void {
	const config = readPipelineConfig(runtime);
	const fetchContext = fetchContextFor(runtime, config.todoistToken);
	const projects = fetchAllTodoistPages<TodoistProject>(
		fetchContext,
		projectsRequest(),
	);

	const plan = planBillCycle(
		{
			completionRows: runtime.tables.readRows(
				COMPLETIONS_SOURCE_TAB,
			),
			liveTasks: fetchAllTodoistPages<TodoistTask>(
				fetchContext,
				openTasksRequest(),
			),
			projectTree: toProjectTree(projects),
			areaMap: AREA_MAP,
			timezone: config.timezone,
		},
		BILL_CYCLE_TAB,
		formatDayInTimezone(runtime.clock.now(), config.timezone),
	);

	if (!options.dryRun)
		runtime.tables.ensureTable(BILL_CYCLE_TAB, BILL_CYCLE_HEADER);
	applyWritePlan(plan, runtime.tables, runtime.state, runtime.logger, {
		dryRun: options.dryRun,
	});
}

function runPortSyncAreaDaily(runtime: Runtime, options: RunOptions): void {
	const config = readPipelineConfig(runtime);
	const fetchContext = fetchContextFor(runtime, config.todoistToken);
	const projects = fetchAllTodoistPages<TodoistProject>(
		fetchContext,
		projectsRequest(),
	);

	const plan = planAreaDaily(
		{
			openTasks: fetchAllTodoistPages<TodoistTask>(
				fetchContext,
				openTasksRequest(),
			),
			completionRows: runtime.tables.readRows(
				COMPLETIONS_SOURCE_TAB,
			),
			projectTree: toProjectTree(projects),
			areaMap: AREA_MAP,
			timezone: config.timezone,
		},
		AREA_DAILY_TAB,
		formatDayInTimezone(runtime.clock.now(), config.timezone),
	);

	if (!options.dryRun)
		runtime.tables.ensureTable(AREA_DAILY_TAB, AREA_DAILY_HEADER);
	applyWritePlan(plan, runtime.tables, runtime.state, runtime.logger, {
		dryRun: options.dryRun,
	});
}

function runPortSyncTaskDaily(runtime: Runtime, options: RunOptions): void {
	const config = readPipelineConfig(runtime);
	const fetchContext = fetchContextFor(runtime, config.todoistToken);
	const projects = fetchAllTodoistPages<TodoistProject>(
		fetchContext,
		projectsRequest(),
	);
	const sections = fetchAllTodoistPages<TodoistProject>(
		fetchContext,
		sectionsRequest(),
	);

	const plan = planTaskDaily(
		{
			openTasks: fetchAllTodoistPages<TodoistTask>(
				fetchContext,
				openTasksRequest(),
			),
			// Its own previous day. This tab is self-referential, which is why
			// the read happens before anything is written.
			existingRows: runtime.tables.readRows(TASK_DAILY_TAB),
			projectTree: toProjectTree(projects),
			sectionNamesById: toIdNameMap(sections),
			areaMap: AREA_MAP,
		},
		TASK_DAILY_TAB,
		formatDayInTimezone(runtime.clock.now(), config.timezone),
	);

	if (!options.dryRun)
		runtime.tables.ensureTable(TASK_DAILY_TAB, TASK_DAILY_HEADER);
	applyWritePlan(plan, runtime.tables, runtime.state, runtime.logger, {
		dryRun: options.dryRun,
	});
}

function runPortSyncHabitDaily(runtime: Runtime, options: RunOptions): void {
	const config = readPipelineConfig(runtime);

	// No Todoist call at all: this tab is derived entirely from two others.
	const plan = planHabitDaily(
		{
			spineRows: runtime.tables.readRows(
				RECURRING_STATUS_SOURCE_TAB,
			),
			completionRows: runtime.tables.readRows(
				COMPLETIONS_SOURCE_TAB,
			),
			existingRows: runtime.tables.readRows(HABIT_DAILY_TAB),
			timezone: config.timezone,
		},
		HABIT_DAILY_TAB,
		formatDayInTimezone(runtime.clock.now(), config.timezone),
	);

	if (!options.dryRun)
		runtime.tables.ensureTable(HABIT_DAILY_TAB, HABIT_DAILY_HEADER);
	applyWritePlan(plan, runtime.tables, runtime.state, runtime.logger, {
		dryRun: options.dryRun,
	});
}

// ── Reschedule habits (D11) ──────────────────────────────────────────────────
//
// ⚠️ THE ONLY WRITE PATH TO TODOIST. The B4b guards protect tabs and state keys;
// neither applies here, because there is no shadow Todoist to write to. The dry
// run is therefore not a convenience on this entry point — it is the ONLY rail,
// which is why it is listed first in the editor and why the log prints every
// command it would send before sending any.
//
// It stays MANUAL. No trigger, ever: a scheduled job that silently moves tasks
// in the app you plan your day with is a different kind of thing from one that
// writes a spreadsheet.
function runPortRescheduleHabits(runtime: Runtime, options: RunOptions): void {
	const config = readPipelineConfig(runtime);
	const fetchContext = fetchContextFor(runtime, config.todoistToken);

	const projects = fetchAllTodoistPages<TodoistProject>(
		fetchContext,
		projectsRequest(),
	);
	const habitsProjectId = Object.entries(toIdNameMap(projects)).find(
		([, name]) => name === HABITS_PROJECT_NAME,
	)?.[0];
	if (!habitsProjectId) {
		throw new Error(
			`Reschedule: no project named "${HABITS_PROJECT_NAME}". It must not gain ` +
				`a parent of the same name either — the match takes the first hit.`,
		);
	}

	const sections = fetchAllTodoistPages<
		TodoistProject & { project_id?: string }
	>(fetchContext, sectionsRequest());
	const now = runtime.clock.now();
	const allCommands: UpdateCommand[] = [];

	for (const plainName of HABIT_SECTIONS) {
		// Matched by SUBSTRING so the emoji prefix ("🌅 Morning Routine") does
		// not have to be reproduced here.
		const section = sections.find(
			(candidate) =>
				String(candidate.project_id ?? "") ===
					habitsProjectId &&
				(candidate.name ?? "").includes(plainName),
		);
		if (!section) {
			runtime.logger.log(
				`Reschedule: no section matching "${plainName}"`,
			);
			continue;
		}

		const tasks = fetchAllTodoistPages<TodoistTask>(
			fetchContext,
			sectionTasksRequest(String(section.id ?? "")),
		);
		const plan = planHabitReschedule(
			section.name ?? plainName,
			tasks,
			now,
			config.timezone,
			() => runtime.ids.newUuid(),
		);
		for (const line of plan.logLines) runtime.logger.log(line);
		allCommands.push(...plan.commands);
	}

	if (allCommands.length === 0) {
		runtime.logger.log(
			"Reschedule: nothing is stale enough to move.",
		);
		return;
	}

	if (options.dryRun) {
		runtime.logger.log(
			`Reschedule: DRY RUN — ${allCommands.length} command(s) NOT sent to Todoist.`,
		);
		return;
	}

	const response = runtime.http.post(
		`${TODOIST_API_BASE}/sync`,
		{ Authorization: `Bearer ${config.todoistToken}` },
		JSON.stringify({ commands: allCommands }),
	);
	if (response.status >= 300) {
		throw new Error(
			`Todoist /sync → HTTP ${response.status}: ${response.body.slice(0, 300)}`,
		);
	}

	// sync_status maps each command uuid to "ok" or an error object. A partial
	// failure is the normal shape here, so it is surfaced rather than assumed
	// away — the request succeeded, individual commands may not have.
	const parsed = parseJsonBody(response.body) as {
		sync_status?: Record<string, unknown>;
	};
	const failures = Object.entries(parsed.sync_status ?? {}).filter(
		([, value]) => value !== "ok",
	);
	if (failures.length > 0) {
		throw new Error(
			`Reschedule: ${failures.length} of ${allCommands.length} command(s) failed: ` +
				JSON.stringify(failures).slice(0, 300),
		);
	}
	runtime.logger.log(`Reschedule: ${allCommands.length} task(s) moved.`);
}

// Settings every pipeline needs. Read through requireSetting so a missing one
// throws saying which, rather than surfacing later as an empty result set.
function readPipelineConfig(runtime: Runtime): {
	todoistToken: string;
	timezone: string;
} {
	return {
		todoistToken: requireSetting(runtime.settings, "TODOIST_TOKEN"),
		// The zone the day keys are computed in. Explicit, never ambient — a
		// GitHub runner is UTC and has no script timezone, and reading UTC here
		// would file every evening event a day late.
		timezone: readSetting(
			runtime.settings,
			"TODOIST_TIMEZONE",
			"America/Mexico_City",
		),
	};
}

export const entryPoints: readonly EntryPoint[] = [
	{
		name: "ping",
		kind: "diagnostic",
		summary: "Smoke test: proves the bundle is deployed and runnable. Writes nothing.",
		run: runPortPing,
	},
	{
		name: "syncOverdue",
		kind: "manual",
		writes: [OVERDUE_TAB],
		summary: "Snapshot of every overdue task, replacing today's rows. Reads Todoist, writes Overdue_port.",
		run: runPortSyncOverdue,
	},
	{
		name: "syncRecurringStatus",
		kind: "manual",
		writes: [RECURRING_STATUS_TAB],
		summary: "Daily snapshot of every recurring task — the spine HabitDaily reads.",
		run: runPortSyncRecurringStatus,
	},
	{
		name: "syncKarmaStats",
		kind: "manual",
		writes: [KARMA_STATS_TAB],
		summary: "Todoist's own productivity numbers, upserted one row per day.",
		run: runPortSyncKarmaStats,
	},
	{
		name: "syncCompletions",
		kind: "manual",
		writes: [COMPLETIONS_TAB],
		summary: "Three completion sources, deduped and appended. The only pipeline that persists a cursor.",
		run: runPortSyncCompletions,
	},
	{
		name: "syncBillCycle",
		kind: "manual",
		writes: [BILL_CYCLE_TAB],
		summary: "One row per bill per cycle, fully rebuilt from Completions_port.",
		run: runPortSyncBillCycle,
	},
	{
		name: "syncAreaDaily",
		kind: "manual",
		writes: [AREA_DAILY_TAB],
		summary: "Dense area x day counts. Snapshot columns cannot be backfilled.",
		run: runPortSyncAreaDaily,
	},
	{
		name: "syncTaskDaily",
		kind: "manual",
		writes: [TASK_DAILY_TAB],
		summary: "One row per open task per day, with aging read from its own previous day.",
		run: runPortSyncTaskDaily,
	},
	{
		name: "syncHabitDaily",
		kind: "manual",
		writes: [HABIT_DAILY_TAB],
		summary: "The dense habit x day grid. Runs LAST: it reads Completions_port and RecurringStatus_port.",
		run: runPortSyncHabitDaily,
	},
	{
		name: "rescheduleHabits",
		kind: "manual",
		writesExternally: true,
		summary: "Bumps skipped habit tasks to their next matching day. WRITES TO TODOIST — use the dry run first.",
		run: runPortRescheduleHabits,
	},
	{
		name: "pingWrite",
		kind: "diagnostic",
		writes: [PING_TAB],
		summary: "Smoke test with a write: appends one row to Ping_port. Has a dry-run twin.",
		run: runPortPingWrite,
	},
];
