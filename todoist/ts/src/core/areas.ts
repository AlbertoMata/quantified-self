// ─────────────────────────────────────────────────────────────────────────────
// Life areas — resolving "which part of my life is this?"
//
// Tracking is organised by Todoist PROJECT, but an area spans several: bills
// live across Bills, Finance, Mortgage, Credit Cards, SAT and Purchases, and
// `Week` deliberately mixes bills with errands because it is a prioritisation
// view rather than a category.
//
// RESOLUTION ORDER, and the `source` each step records:
//   1. an `area-*` label on the task  → "label"   (you told me)
//   2. an explicit project override   → "project" (Week / Habits / Inbox)
//   3. the nearest mapped ancestor    → "parent"  (I derived it)
//   4. nothing matched                → "default" (uncategorized)
//
// `source` is the honesty marker, and the reason the return type is a pair
// rather than a string: it separates what you declared from what the code
// inferred, so a derived value can be excluded from a chart rather than silently
// averaged in as though it were declared.
//
// THE TREE IS WHAT MAKES THIS SELF-MAINTAINING. A project created under
// `💰 Bills & Taxes` is a bill from the moment it exists, with no code edit and
// no map entry. Only three project ids are hardcoded, and they are exactly the
// three that sit outside the tree on purpose.
//
// KEYED BY PROJECT ID, NEVER BY NAME. A rename would otherwise silently re-home
// an entire project's history — and `Study/Reading` cannot be addressed by name
// at all, because the `/` breaks Todoist's filter syntax even when quoted. This
// is also why deleting `Ascensus` needed no edit here.
//
// See todoist/area-contract.md for how a task is authored.
// ─────────────────────────────────────────────────────────────────────────────

import { toLabelList } from "./labels.ts";

export const AREA_LABEL_PREFIX = "area-";
export const AREA_UNCATEGORIZED = "uncategorized";

export type AreaSource = "label" | "project" | "parent" | "default";

export interface ResolvedArea {
	readonly area: string;
	readonly source: AreaSource;
}

// id → { name, parentId }. Built from one cached /projects call by the caller
// and passed in, never fetched here — that is what keeps this testable and stops
// a 200-task loop making 200 cache reads.
export interface ProjectNode {
	readonly name: string;
	readonly parentId: string;
}
export type ProjectTree = Readonly<Record<string, ProjectNode>>;

export interface AreaMap {
	// Parent project → area. The part that GROWS BY ITSELF.
	readonly byParentId: Readonly<Record<string, string>>;
	// Projects that sit outside the tree and carry their own area.
	readonly byProjectId: Readonly<Record<string, string>>;
	// Tiebreak order when a task carries MORE THAN ONE area label. Todoist does
	// not guarantee label order, so reading the task's own order would make the
	// answer non-deterministic across runs.
	readonly order: readonly string[];
	readonly weekProjectId: string;
}

// Depth guard for the ancestor walk. The tree is one level deep today; this
// exists so a future sub-sub-project resolves, and so a cyclic parent_id — which
// Todoist should never produce — cannot hang a nightly sync.
const MAX_TREE_DEPTH = 10;

// Resolve one task's area. Pure: the tree and the map are both injected.
//
// `labels` accepts the API's array or a sheet cell's comma string, because
// callers exist on both sides.
export function resolveArea(
	projectId: unknown,
	labels: unknown,
	tree: ProjectTree,
	map: AreaMap,
): ResolvedArea {
	const list = toLabelList(labels);

	// 1. An explicit label always wins — the escape hatch for a task that
	//    contradicts wherever it happens to live. Ordered by consequence, so a
	//    task tagged both bills-taxes and errands counts as a bill: that is the
	//    error which surfaces where being wrong is expensive.
	for (const area of map.order) {
		if (list.includes(AREA_LABEL_PREFIX + area)) {
			return { area, source: "label" };
		}
	}

	const id = String(projectId ?? "");
	if (!id) return { area: AREA_UNCATEGORIZED, source: "default" };

	// 2. An explicit override on the project itself.
	const override = map.byProjectId[id];
	if (override) return { area: override, source: "project" };

	// 3. Walk up to the nearest mapped ancestor.
	let cursor = tree[id];
	let depth = 0;
	while (cursor && depth < MAX_TREE_DEPTH) {
		depth += 1;
		const parentId = cursor.parentId;
		if (!parentId) break;

		const fromParent =
			map.byParentId[parentId] ?? map.byProjectId[parentId];
		if (fromParent) return { area: fromParent, source: "parent" };

		cursor = tree[parentId];
	}

	// 4. Never guess. A visible undercount beats invisible inflation.
	return { area: AREA_UNCATEGORIZED, source: "default" };
}

// `Week` is a focus view, not a category, so membership is ORTHOGONAL to area.
// It answers "is my week actually aimed where I said it was" without letting a
// prioritised bill book itself as an errand.
export function isInWeek(projectId: unknown, map: AreaMap): boolean {
	return String(projectId ?? "") === map.weekProjectId;
}

// Every area label present on a task.
//
// Used to spot the ambiguous ones: resolveArea silently picks by `order`, and
// silence is the wrong response to a task its author tagged two ways.
export function areaLabelsOn(labels: unknown, map: AreaMap): string[] {
	const list = toLabelList(labels);
	return map.order.filter((area) =>
		list.includes(AREA_LABEL_PREFIX + area),
	);
}
