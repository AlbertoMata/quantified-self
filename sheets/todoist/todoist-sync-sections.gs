// ─────────────────────────────────────────────────────────────────────────────
// Todoist Sync — Section "In Review" Completions
// Counts tasks sitting in an "In Review" section (Fullsteam / Ascensus / Work)
// as completion events — i.e. PR reviewed / story ready.
// ─────────────────────────────────────────────────────────────────────────────

// IMPORTANT: the Todoist v1 activity log does NOT expose section_id on item:updated
// events — verified live, extra_data only carries content/description deltas, never
// the section a task moved into. So a MOVE into "In Review" is undetectable from the
// event stream (the old approach filtered on a field that's never present → 0 rows).
//
// Instead we snapshot the current state: this returns EVERY task presently in an
// "In Review" section of a target project. syncCompletions then diffs that snapshot
// against the previous run's membership (getPrevInReviewIds) and counts only the tasks
// that entered since last run — so a lingering task isn't re-appended every night.
//
// sinceDate is unused (a snapshot has no time window) but kept for call-site symmetry.
function fetchSectionMovementCompletions(projectNames, sinceDate, until) {
	try {
		const sectionMap = getSectionMap();

		// Every section ID named "In Review" across the account. The per-project task
		// query below constrains these to the target projects only.
		const inReviewSectionIds = {};
		Object.entries(sectionMap).forEach(([sectionId, name]) => {
			if (name === IN_REVIEW_SECTION_NAME) {
				inReviewSectionIds[sectionId] = true;
			}
		});

		if (Object.keys(inReviewSectionIds).length === 0) {
			Logger.log(
				`No "${IN_REVIEW_SECTION_NAME}" sections found; skipping section snapshot`,
			);
			return [];
		}

		// One filter query for all target projects: "#Fullsteam | #Ascensus | #Work".
		const query = projectNames
			.map((name) => `#${name}`)
			.join(" | ");
		const tasks = todoistGetPaged("/tasks/filter", { query });

		const inReview = tasks.filter(
			(t) =>
				t.section_id &&
				inReviewSectionIds[String(t.section_id)] ===
					true,
		);
		Logger.log(
			`Section snapshot: ${inReview.length} of ${tasks.length} target-project tasks are in "${IN_REVIEW_SECTION_NAME}"`,
		);

		// Shape each like a completion event for the syncCompletions row mapper.
		// completed_at = detection time; the API gives us no actual move timestamp.
		return inReview.map((t) => ({
			id: t.id,
			completed_at: until.toISOString(),
			content: t.content || "",
			project_id: t.project_id || null,
			section_id: t.section_id || null,
			labels: Array.isArray(t.labels) ? t.labels : [],
			priority: t.priority || 1,
			due: t.due
				? {
						is_recurring:
							!!t.due.is_recurring,
						date: t.due.date || "",
					}
				: null,
			duration: t.duration || null,
			parent_id: t.parent_id || null,
		}));
	} catch (e) {
		Logger.log(`Section snapshot failed: ${e}`);
		return [];
	}
}
