// ─────────────────────────────────────────────────────────────────────────────
// The live area map
//
// The only configuration in this project that is CODE rather than a setting,
// and deliberately so: it is a statement about how a life is organised, it
// changes perhaps twice a year, and every change deserves a diff.
//
// KEYED BY PROJECT ID, NEVER BY NAME. A rename would otherwise silently re-home
// an entire project's history, and `Study/Reading` cannot be addressed by name
// at all — the `/` breaks Todoist's filter syntax even when quoted. It is also
// why deleting `Ascensus` needed no edit here at all.
//
// Ported verbatim from todoist-areas.gs. See todoist/area-contract.md.
// ─────────────────────────────────────────────────────────────────────────────

import type { AreaMap } from "../../core/areas.ts";

export const AREA_MAP: AreaMap = {
	// Every project nested under one of these inherits its area. THIS IS THE
	// PART THAT GROWS BY ITSELF — a new project under 💰 Bills & Taxes is a bill
	// from the moment it exists, with no code edit.
	byParentId: {
		"6hRq7W9rfWC9x8R9": "work", // 💼 Work
		"6hRq7WF8xRQGr3MV": "bills-taxes", // 💰 Bills & Taxes
		"6hRq7WG9X5ghWhRM": "errands", // 📋 Errands
	},

	// The three projects that sit OUTSIDE the tree, and why each one does:
	//   Habits — its own area, and it must not gain a parent named `Habits`;
	//            the reschedule path matches by exact name and takes the first
	//            hit, so a second would silently break it.
	//   Week   — a focus view whose cards span every area. Defaults to errands
	//            and carries the orthogonal in_week flag instead of distorting
	//            totals.
	//   Inbox  — the untriaged pile; errands is the honest default.
	byProjectId: {
		"6g24MC65RvRwJ4wX": "habits", // Habits
		"6hCMV4WJ343crQmc": "errands", // Week
		"6fgjwG76Qf3h2787": "errands", // Inbox
	},

	// Tiebreak when a task carries more than one area label. ORDERED BY
	// CONSEQUENCE: a task tagged both bills-taxes and errands counts as a bill,
	// because that is the error which surfaces where being wrong is expensive.
	// errands is last as the catch-all. This is a tiebreak, not a blessing —
	// a task tagged two ways is worth finding.
	order: ["bills-taxes", "work", "habits", "errands"],

	weekProjectId: "6hCMV4WJ343crQmc",
};

// Projects whose "In Review" section counts as a completion event.
//
// `Ascensus` was dropped 2026-09-09: the project no longer exists in Todoist and
// held 0 tasks long before that, so no historical row came from it.
export const IN_REVIEW_TARGET_PROJECTS = ["Work"];
export const IN_REVIEW_SECTION_NAME = "In Review";
