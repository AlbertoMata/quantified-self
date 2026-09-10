// ─────────────────────────────────────────────────────────────────────────────
// Todoist Sync — Life Areas
//
// The question no existing tab could answer: "how am I doing in each area of my
// life?" Tracking is organised by Todoist PROJECT, but an area spans several —
// bills live across Bills, Finance, Mortgage, Credit Cards, SAT and Purchases, and
// `Week` deliberately mixes bills with errands because it is a prioritisation view
// rather than a category.
//
// This file is the single source of truth for that mapping. Several tabs read it,
// so it stays small, pure where it can be, and has no side effect beyond one cached
// /projects call.
//
// RESOLUTION ORDER (areaOf):
//   1. an `area-*` label on the task     → source "label"    (you told me)
//   2. an explicit project override      → source "project"  (Week / Habits / Inbox)
//   3. the nearest mapped ancestor       → source "parent"   (I derived it)
//   4. nothing matched                   → "uncategorized", source "default"
//
// The tree is what makes this self-maintaining: a project created under
// `💰 Bills & Taxes` is a bill from the moment it exists, with no code edit and no
// map entry. Only three project ids are hardcoded, and they are exactly the three
// that sit OUTSIDE the tree on purpose.
//
// Keyed by project_id, never by name. A rename would otherwise silently re-home an
// entire project's history, and `Study/Reading` cannot be addressed by name at all:
// the `/` breaks Todoist's filter syntax even when quoted.
//
// See area-contract.md for how a task is authored, and
// ../../docs/plans/life-areas.md for why the tree is shaped this way.
// ─────────────────────────────────────────────────────────────────────────────

// ── The map ────────────────────────────────────────────────────────────────

const AREA_LABEL_PREFIX = "area-";
const AREA_UNCATEGORIZED = "uncategorized";

// Parent project → area. Every project nested under one of these inherits it.
// This is the part that should GROW BY ITSELF: adding a project under a parent
// needs no edit here.
const AREA_BY_PARENT_ID = {
	"6hRq7W9rfWC9x8R9": "work", // 💼 Work
	"6hRq7WF8xRQGr3MV": "bills-taxes", // 💰 Bills & Taxes
	"6hRq7WG9X5ghWhRM": "errands", // 📋 Errands
};

// The three projects that sit outside the tree, and why each one does:
//   Habits — its own area, and it must NOT gain a parent named `Habits`;
//            getHabitsProjectId() matches by exact name and takes the first hit,
//            so a second one would silently break rescheduleAllHabits().
//   Week   — a focus view whose cards span every area. Defaults to errands and
//            carries the orthogonal in_week flag instead of distorting totals.
//   Inbox  — the untriaged pile; errands is the honest default for it.
const AREA_BY_PROJECT_ID = {
	"6g24MC65RvRwJ4wX": "habits", // Habits
	"6hCMV4WJ343crQmc": "errands", // Week
	"6fgjwG76Qf3h2787": "errands", // Inbox
};

const WEEK_PROJECT_ID = "6hCMV4WJ343crQmc";

// Tiebreak order when a task carries MORE THAN ONE area label. Todoist does not
// guarantee label order, so reading the task's own order would make the answer
// non-deterministic across runs. Ordered by consequence: a task tagged both
// bills-taxes and errands counts as a bill, because that is the error that
// surfaces in the report where being wrong is expensive. `errands` is last as the
// catch-all. diagnoseAreas() reports multi-label tasks — this order is a tiebreak,
// not a blessing.
const AREA_ORDER = ["bills-taxes", "work", "habits", "errands"];

// Depth guard for the ancestor walk. The tree is one level deep today; this exists
// so a future sub-sub-project resolves correctly, and so a cyclic parent_id (which
// Todoist should never produce) cannot hang a nightly sync.
const AREA_MAX_TREE_DEPTH = 10;

const AREA_TREE_CACHE_KEY = "TODOIST_PROJECT_TREE";

// ── Project tree (cached 6h) ───────────────────────────────────────────────

// id → { name, parentId }. A companion to getProjectMap() rather than a rewrite of
// it: that one returns id→name and has several callers, none of which should have
// to change to learn about parents.
function getProjectTree() {
	const cache = CacheService.getScriptCache();
	const cached = cache.get(AREA_TREE_CACHE_KEY);
	if (cached) return JSON.parse(cached);

	const items = todoistGetPaged("/projects");
	const tree = {};
	items.forEach((p) => {
		tree[String(p.id)] = {
			name: p.name,
			parentId: p.parent_id ? String(p.parent_id) : "",
		};
	});
	cache.put(AREA_TREE_CACHE_KEY, JSON.stringify(tree), 21600); // 6h
	return tree;
}

// ── areaOf — the pure core ─────────────────────────────────────────────────

// PURE: the tree is injected, never fetched. Every tab that resolves areas for a
// batch of tasks should call getProjectTree() ONCE and pass it in — that keeps this
// testable off-platform and keeps a 200-task loop from making 200 cache reads.
//
// `labels` accepts either the API's array or a sheet cell's comma string, because
// callers exist on both sides.
//
// Returns { area, source }. `source` is the honesty marker: it separates what you
// declared from what the code inferred, so a derived value can be excluded from a
// chart rather than silently averaged in as though it were declared.
function areaOf(projectId, labels, tree) {
	const list = Array.isArray(labels) ? labels : splitLabels(labels);

	// 1. An explicit label always wins — it is the escape hatch for a task that
	//    contradicts wherever it happens to live.
	for (let i = 0; i < AREA_ORDER.length; i++) {
		if (hasLabel(list, AREA_LABEL_PREFIX + AREA_ORDER[i])) {
			return { area: AREA_ORDER[i], source: "label" };
		}
	}

	const id = String(projectId || "");
	if (!id) return { area: AREA_UNCATEGORIZED, source: "default" };

	// 2. An explicit override on the project itself.
	if (AREA_BY_PROJECT_ID[id]) {
		return { area: AREA_BY_PROJECT_ID[id], source: "project" };
	}

	// 3. Walk up to the nearest mapped ancestor.
	const nodes = tree || {};
	let cursor = nodes[id];
	let depth = 0;
	while (cursor && depth++ < AREA_MAX_TREE_DEPTH) {
		const parentId = cursor.parentId;
		if (!parentId) break;
		if (AREA_BY_PARENT_ID[parentId]) {
			return {
				area: AREA_BY_PARENT_ID[parentId],
				source: "parent",
			};
		}
		if (AREA_BY_PROJECT_ID[parentId]) {
			return {
				area: AREA_BY_PROJECT_ID[parentId],
				source: "parent",
			};
		}
		cursor = nodes[parentId];
	}

	// 4. Never guess. A visible undercount beats invisible inflation — the same
	//    bargain habits-contract.md already strikes.
	return { area: AREA_UNCATEGORIZED, source: "default" };
}

// `Week` is a focus view, not a category, so membership is orthogonal to area.
// Answers "is my week actually aimed where I said it was" without letting a
// prioritised bill book itself as an errand.
function inWeekOf(projectId) {
	return String(projectId || "") === WEEK_PROJECT_ID;
}

// Every area label present on a task. Used to spot the ambiguous ones — areaOf()
// silently resolves them by AREA_ORDER, and silence is the wrong response to a task
// its author tagged two ways.
function areaLabelsOn(labels) {
	const list = Array.isArray(labels) ? labels : splitLabels(labels);
	return AREA_ORDER.filter((a) => hasLabel(list, AREA_LABEL_PREFIX + a));
}

// ── diagnoseAreas — run this first in any session ──────────────────────────
//
// READ-ONLY. Writes nothing, changes nothing; makes one /tasks call and reads the
// Completions tab. Its output is authoritative over any document, including the
// plan — run it before trusting a stale description of the current state.
function diagnoseAreas() {
	const tree = getProjectTree();
	const tasks = todoistGetPaged("/tasks");
	Logger.log(`diagnoseAreas: ${tasks.length} open tasks`);

	const perArea = {};
	const perSource = {};
	const uncategorized = [];
	const weekUnlabelled = [];
	const unknownProjects = {};
	const parentsHoldingTasks = {};
	const staleLabels = [];
	const multiLabelled = [];

	tasks.forEach((t) => {
		const pid = String(t.project_id || "");
		const labels = t.labels || [];
		const resolved = areaOf(pid, labels, tree);
		perArea[resolved.area] = (perArea[resolved.area] || 0) + 1;
		perSource[resolved.source] =
			(perSource[resolved.source] || 0) + 1;

		const name = (tree[pid] && tree[pid].name) || `id:${pid}`;

		if (resolved.area === AREA_UNCATEGORIZED) {
			uncategorized.push(`${t.content} [${name}]`);
		}
		if (!tree[pid]) unknownProjects[pid] = true;

		// A parent is a CONTAINER. A task filed directly into one sits in a project
		// with no parent of its own, so it resolves only if some label saves it.
		if (AREA_BY_PARENT_ID[pid]) {
			parentsHoldingTasks[name] =
				(parentsHoldingTasks[name] || 0) + 1;
		}

		if (inWeekOf(pid) && areaLabelsOn(labels).length === 0) {
			weekUnlabelled.push(t.content);
		}

		const present = areaLabelsOn(labels);
		if (present.length > 1) {
			multiLabelled.push(
				`${t.content} [${name}] → ${present.join(", ")} (resolved: ${resolved.area})`,
			);
		}

		// A label outlives the move that made it wrong. Where the label and the
		// tree disagree the label wins BY DESIGN — correct for a deliberate
		// override, wrong for one left behind by a task that changed projects.
		// Only the author can tell those apart, so surface it rather than guess.
		if (resolved.source === "label" && present.length === 1) {
			const derived = areaOf(pid, [], tree);
			if (
				derived.area !== AREA_UNCATEGORIZED &&
				derived.area !== resolved.area &&
				!inWeekOf(pid)
			) {
				staleLabels.push(
					`${t.content} [${name}] → label says ${resolved.area}, tree says ${derived.area}`,
				);
			}
		}
	});

	Logger.log(`Open tasks per area: ${JSON.stringify(perArea)}`);
	Logger.log(`Resolved by: ${JSON.stringify(perSource)}`);

	logAreaList("UNCATEGORIZED (the worklist)", uncategorized);
	logAreaList("`Week` cards with no area label", weekUnlabelled);
	logAreaList(
		"Tagged two ways (AREA_ORDER broke the tie)",
		multiLabelled,
	);
	logAreaList(
		"Label disagrees with the tree (possibly stale)",
		staleLabels,
	);

	const unknownIds = Object.keys(unknownProjects);
	if (unknownIds.length) {
		Logger.log(
			`TRIPWIRE — tasks in projects missing from the tree: ${unknownIds.join(", ")}. ` +
				`Clear the ${AREA_TREE_CACHE_KEY} cache or check for a deleted project.`,
		);
	}

	const heldParents = Object.keys(parentsHoldingTasks);
	if (heldParents.length) {
		Logger.log(
			`TRIPWIRE — parent projects are holding tasks directly: ${heldParents
				.map((n) => `${n} (${parentsHoldingTasks[n]})`)
				.join(", ")}. ` +
				`Parents are containers; move these into a child project.`,
		);
	} else {
		Logger.log(
			"Parent projects hold no tasks directly — as intended.",
		);
	}

	// Every project the tree knows that no rule can resolve. Catches a project
	// left at the top level after a reorg, BEFORE its tasks show up as
	// uncategorized.
	const orphanProjects = Object.keys(tree).filter((id) => {
		if (AREA_BY_PARENT_ID[id] || AREA_BY_PROJECT_ID[id])
			return false;
		return areaOf(id, [], tree).area === AREA_UNCATEGORIZED;
	});
	logAreaList(
		"Projects no rule can resolve (a task added here lands uncategorized)",
		orphanProjects.map((id) => `${tree[id].name} (${id})`),
	);

	diagnoseAreaCompletions(tree);
}

// Completion history, resolved by project_id. Labels are frozen at capture, so
// history resolves through the TREE, not through labels — which is why area is
// fully retroactive while label-based area is go-forward only.
function diagnoseAreaCompletions(tree) {
	const ss = SpreadsheetApp.openById(TODOIST_SPREADSHEET_ID);
	const sheet = ss.getSheetByName("Completions");
	if (!sheet || sheet.getLastRow() < 2) {
		Logger.log("Completions: tab missing or empty");
		return;
	}
	const data = sheet.getDataRange().getValues();
	const perArea = {};
	const days = [];
	for (let i = 1; i < data.length; i++) {
		const day = dateKey(data[i][0]).slice(0, 10);
		if (day) days.push(day);
		// Col D is project_id — present on every row since the tab was created,
		// which is what makes the whole history re-derivable without an API call.
		const resolved = areaOf(String(data[i][3] || ""), [], tree);
		perArea[resolved.area] = (perArea[resolved.area] || 0) + 1;
	}
	days.sort();
	Logger.log(
		`Completions: ${data.length - 1} rows, ${days[0]} → ${days[days.length - 1]}`,
	);
	Logger.log(
		`Completions per area (from project_id): ${JSON.stringify(perArea)}`,
	);
}

function logAreaList(title, items) {
	if (!items || items.length === 0) {
		Logger.log(`${title}: none`);
		return;
	}
	Logger.log(`${title}: ${items.length}`);
	items.forEach((i) => Logger.log(`   • ${i}`));
}
