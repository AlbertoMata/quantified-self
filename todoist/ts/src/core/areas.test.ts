// C4 — area resolution and bill-cycle status. The life-areas harness, committed.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
	areaLabelsOn,
	AREA_UNCATEGORIZED,
	isInWeek,
	resolveArea,
	type AreaMap,
	type ProjectTree,
} from "./areas.ts";
import {
	billCycleStatus,
	cycleOf,
	daysToClose,
	nextOnTimeCloseStreak,
} from "./bill-cycle.ts";

// The live map, as todoist-areas.gs holds it. Ids are real; names are comments
// there for the same reason they are here — the ids are what resolve.
const WORK_PARENT = "6hRq7W9rfWC9x8R9"; // 💼 Work
const BILLS_PARENT = "6hRq7WF8xRQGr3MV"; // 💰 Bills & Taxes
const ERRANDS_PARENT = "6hRq7WG9X5ghWhRM"; // 📋 Errands
const HABITS_PROJECT = "6g24MC65RvRwJ4wX";
const WEEK_PROJECT = "6hCMV4WJ343crQmc";
const INBOX_PROJECT = "6fgjwG76Qf3h2787";

const MAP: AreaMap = {
	byParentId: {
		[WORK_PARENT]: "work",
		[BILLS_PARENT]: "bills-taxes",
		[ERRANDS_PARENT]: "errands",
	},
	byProjectId: {
		[HABITS_PROJECT]: "habits",
		[WEEK_PROJECT]: "errands",
		[INBOX_PROJECT]: "errands",
	},
	order: ["bills-taxes", "work", "habits", "errands"],
	weekProjectId: WEEK_PROJECT,
};

const TREE: ProjectTree = {
	[WORK_PARENT]: { name: "💼 Work", parentId: "" },
	[BILLS_PARENT]: { name: "💰 Bills & Taxes", parentId: "" },
	[ERRANDS_PARENT]: { name: "📋 Errands", parentId: "" },
	work: { name: "Work", parentId: WORK_PARENT },
	mortgage: { name: "Mortgage", parentId: BILLS_PARENT },
	sat: { name: "SAT", parentId: BILLS_PARENT },
	groceries: { name: "Groceries", parentId: ERRANDS_PARENT },
	// One level deeper, to prove the walk does not stop at the first hop.
	"credit-cards": { name: "Credit Cards", parentId: "mortgage" },
	// Outside the tree entirely.
	orphan: { name: "Orphan", parentId: "" },
	[HABITS_PROJECT]: { name: "Habits", parentId: "" },
	[WEEK_PROJECT]: { name: "Week", parentId: "" },
	[INBOX_PROJECT]: { name: "Inbox", parentId: "" },
};

// ── resolution order ─────────────────────────────────────────────────────────

test("an explicit label beats everything", () => {
	// The escape hatch for a task that contradicts wherever it lives: a bill
	// sitting in the Work project is still a bill.
	assert.deepEqual(resolveArea("work", ["area-bills-taxes"], TREE, MAP), {
		area: "bills-taxes",
		source: "label",
	});
});

test("a project override beats the tree", () => {
	assert.deepEqual(resolveArea(HABITS_PROJECT, [], TREE, MAP), {
		area: "habits",
		source: "project",
	});
});

test("a project inherits its parent's area, with source 'parent'", () => {
	// The self-maintaining part: a project created under 💰 Bills & Taxes is a
	// bill from the moment it exists, with no code edit and no map entry.
	assert.deepEqual(resolveArea("mortgage", [], TREE, MAP), {
		area: "bills-taxes",
		source: "parent",
	});
	assert.deepEqual(resolveArea("groceries", [], TREE, MAP), {
		area: "errands",
		source: "parent",
	});
});

test("the walk climbs more than one level", () => {
	// Credit Cards → Mortgage → 💰 Bills & Taxes. The tree is one level deep
	// today; this is why the walk exists rather than a single parent lookup.
	assert.deepEqual(resolveArea("credit-cards", [], TREE, MAP), {
		area: "bills-taxes",
		source: "parent",
	});
});

test("nothing matched is uncategorized, and says so", () => {
	// Never guess. A visible undercount beats invisible inflation.
	assert.deepEqual(resolveArea("orphan", [], TREE, MAP), {
		area: AREA_UNCATEGORIZED,
		source: "default",
	});
	assert.deepEqual(resolveArea("", [], TREE, MAP), {
		area: AREA_UNCATEGORIZED,
		source: "default",
	});
	assert.deepEqual(resolveArea("never-seen-id", [], TREE, MAP), {
		area: AREA_UNCATEGORIZED,
		source: "default",
	});
});

// ── the honesty marker ───────────────────────────────────────────────────────

test("source separates what you declared from what was inferred", () => {
	// The reason the return is a pair: a derived value can be excluded from a
	// chart rather than silently averaged in as though it were declared.
	assert.equal(
		resolveArea("work", ["area-work"], TREE, MAP).source,
		"label",
	);
	assert.equal(resolveArea("work", [], TREE, MAP).source, "parent");
	assert.equal(
		resolveArea(WEEK_PROJECT, [], TREE, MAP).source,
		"project",
	);
	assert.equal(resolveArea("orphan", [], TREE, MAP).source, "default");
});

// ── determinism ──────────────────────────────────────────────────────────────

test("two area labels resolve by consequence, not by Todoist's order", () => {
	// Todoist does not guarantee label order, so reading the task's own order
	// would make the answer differ between runs. A task tagged both bills-taxes
	// and errands counts as a bill — being wrong there is expensive.
	const both = resolveArea(
		"orphan",
		["area-errands", "area-bills-taxes"],
		TREE,
		MAP,
	);
	const reversed = resolveArea(
		"orphan",
		["area-bills-taxes", "area-errands"],
		TREE,
		MAP,
	);
	assert.equal(both.area, "bills-taxes");
	assert.deepEqual(
		both,
		reversed,
		"the answer must not depend on label order",
	);
});

test("ambiguous tasks can be found, because silence is the wrong response", () => {
	assert.deepEqual(areaLabelsOn(["area-errands", "area-work"], MAP), [
		"work",
		"errands",
	]);
	assert.deepEqual(areaLabelsOn(["area-work"], MAP), ["work"]);
	assert.deepEqual(areaLabelsOn([], MAP), []);
});

// ── week membership ──────────────────────────────────────────────────────────

test("Week is orthogonal to area, not an area of its own", () => {
	// It answers "is my week aimed where I said it was" without letting a
	// prioritised bill book itself as an errand.
	assert.equal(isInWeek(WEEK_PROJECT, MAP), true);
	assert.equal(isInWeek("mortgage", MAP), false);

	const billInWeek = resolveArea(
		WEEK_PROJECT,
		["area-bills-taxes"],
		TREE,
		MAP,
	);
	assert.equal(billInWeek.area, "bills-taxes", "still a bill");
	assert.equal(
		isInWeek(WEEK_PROJECT, MAP),
		true,
		"and still in the week",
	);
});

// ── robustness ───────────────────────────────────────────────────────────────

test("a cyclic parent cannot hang the sync", () => {
	// Todoist should never produce one. The depth guard exists so that if it
	// ever does, a nightly run fails to categorise rather than never returning.
	const cyclic: ProjectTree = {
		a: { name: "A", parentId: "b" },
		b: { name: "B", parentId: "a" },
	};
	assert.deepEqual(resolveArea("a", [], cyclic, MAP), {
		area: AREA_UNCATEGORIZED,
		source: "default",
	});
});

test("labels arrive as an array or a comma string alike", () => {
	assert.equal(
		resolveArea("orphan", "area-work", TREE, MAP).area,
		"work",
	);
	assert.equal(
		resolveArea("orphan", ["area-work"], TREE, MAP).area,
		"work",
	);
});

test("a deleted project simply stops appearing — no edit needed", () => {
	// The payoff of keying by id: removing Ascensus from Todoist needed no
	// change to the map, because a name was never the key.
	assert.deepEqual(resolveArea("deleted-project-id", [], TREE, MAP), {
		area: AREA_UNCATEGORIZED,
		source: "default",
	});
});

// ── bill cycles ──────────────────────────────────────────────────────────────

const TODAY = "2026-09-14";

test("Todoist's flag wins over the dates, because it is timestamp-precise", () => {
	// The legitimate disagreement: due 02:00, ticked 09:00 the same day is
	// was_overdue TRUE but zero days late. Trusting the flag keeps the answer
	// consistent with what Todoist itself shows.
	assert.equal(
		billCycleStatus("2026-09-02", "2026-09-02", "TRUE", TODAY),
		"closed_late",
	);
	assert.equal(
		billCycleStatus("2026-09-05", "2026-09-02", "FALSE", TODAY),
		"closed",
		"an explicit FALSE wins even when the dates say late",
	);
});

test("a blank flag means unknown and falls through to the dates", () => {
	// It must NOT default to closed, or an unverifiable row is quietly scored
	// as on time.
	assert.equal(
		billCycleStatus("2026-09-05", "2026-09-02", "", TODAY),
		"closed_late",
	);
	assert.equal(
		billCycleStatus("2026-09-01", "2026-09-02", "", TODAY),
		"closed",
	);
	assert.equal(
		billCycleStatus("2026-09-02", "2026-09-02", null, TODAY),
		"closed",
	);
});

test("closing early or on the day is closed, not closed_late", () => {
	assert.equal(
		billCycleStatus("2026-09-02", "2026-09-02", "", TODAY),
		"closed",
	);
	assert.equal(
		billCycleStatus("2026-08-30", "2026-09-02", "", TODAY),
		"closed",
	);
});

test("an unticked cycle is open until its due date passes", () => {
	assert.equal(billCycleStatus("", "2026-09-20", "", TODAY), "open");
	assert.equal(
		billCycleStatus("", TODAY, "", TODAY),
		"open",
		"due today is not late yet",
	);
	assert.equal(billCycleStatus("", "2026-09-02", "", TODAY), "overdue");
});

test("days to close is signed, and keeps counting while a cycle is open", () => {
	// An open cycle eleven days past due should read eleven, not blank.
	assert.equal(daysToClose("2026-09-05", "2026-09-02", TODAY), 3);
	assert.equal(daysToClose("2026-08-30", "2026-09-02", TODAY), -3);
	assert.equal(daysToClose("", "2026-09-03", TODAY), 11);
	assert.equal(daysToClose("", "", TODAY), null);
});

test("the cycle is the due date's month", () => {
	assert.equal(cycleOf("2026-09-02"), "2026-09");
	assert.equal(cycleOf("2026-09-02T02:00:00"), "2026-09");
	assert.equal(cycleOf(""), "");
	assert.equal(cycleOf("nonsense"), "");
});

test("only a late close breaks the on-time streak", () => {
	// An UNFINISHED cycle carries, overdue included — it has not failed yet, and
	// closing it late is what the break is for. This matches the legacy rule
	// exactly, because parity is the bar until Phase E: the port must reproduce
	// the number before it is allowed to improve on it.
	assert.equal(nextOnTimeCloseStreak(4, "closed"), 5);
	assert.equal(nextOnTimeCloseStreak(4, "closed_late"), 0);
	assert.equal(nextOnTimeCloseStreak(4, "open"), 4);
	assert.equal(
		nextOnTimeCloseStreak(4, "overdue"),
		4,
		"carries, matching the legacy — arguable, and logged as a post-cutover question",
	);
});

test("the mortgage case reads as documented, not as a bug", () => {
	// PAY THE MORTGAGE is due "every 2nd at 2:00 am", so it is overdue from
	// 02:00 that day and every waking-hour check-off is late by construction.
	// Five of five cycles carry was_overdue TRUE for that reason. The fix is a
	// Todoist-side due time, not a special case here.
	const cycles = [
		"2026-05-02",
		"2026-06-02",
		"2026-07-02",
		"2026-08-02",
		"2026-09-02",
	];
	const statuses = cycles.map((due) =>
		billCycleStatus(due, due, "TRUE", TODAY),
	);
	assert.deepEqual(statuses, Array(5).fill("closed_late"));

	let streak = 3;
	for (const status of statuses)
		streak = nextOnTimeCloseStreak(streak, status);
	assert.equal(streak, 0);
});
