// ─────────────────────────────────────────────────────────────────────────────
// Todoist Sync — Bill Cycles
//
// One row per bill per CYCLE. `HabitDaily`'s twin — spine plus truth — but scored on a
// cycle instead of a day, because a daily rule would score a monthly bill `missed` 30
// days out of 31.
//
// A bill is any task whose area is `bills-taxes`. No extra label: the area already says
// it. Recurring bills produce one row per cycle; one-off obligations produce exactly one,
// which is what keeps `Pay predial` (non-recurring, 31 days overdue on 2026-09-08) from
// falling through a recurring-only rule.
//
// SOURCES
//   * `Completions` is the TRUTH for closed cycles. Col J names the occurrence that
//     closed; col Q carries Todoist's own `was_overdue`.
//   * The live task list supplies the ONE still-open cycle per bill, and the bill's
//     current name.
//
// WHAT THIS TAB CAN AND CANNOT KNOW — read this before trusting a number.
//
// Todoist records when you TICKED THE BOX. It has no idea when money moved. Every column
// here is therefore a measure of *administrative* timeliness, not payment timeliness, and
// the names say so: `closed` / `closed_late`, `days_to_close`, `on_time_close_streak`.
// A bill paid on time and ticked three days later reads `closed_late`, correctly — the
// CYCLE closed late even though the payment did not.
//
// An earlier design claimed `completed_at` was worthless and Todoist's `was_overdue` was
// "the honest signal". That was wrong, and worth stating plainly so it is not re-derived:
// **`was_overdue` IS `completed_at` vs the due date**, computed by Todoist. It is the same
// measurement at better precision, not independent evidence. Nothing in the payload knows
// about payments.
//
// One real consequence: a due TIME can make on-time closure impossible. `PAY THE MORTGAGE`
// is due "every 2nd at 2:00 am", so it is overdue from 02:00 that day — every waking-hour
// check-off is late by construction. Five of five cycles carry `wasOverdue: true` for that
// reason, not because the mortgage was paid late. Fixing the due time is a Todoist-side
// change; see schema/bill-cycle.md.
//
// DELIBERATELY EXCLUDED
//   * `deadline_date` — a fossil. Todoist never advances a deadline when a task recurs,
//     so Telcel's still reads 2026-07-01 while its due date is 2026-09-29.
//   * `priority` — every recurring bill is p1, so it carries no ranking signal. Order
//     by days-until-due instead.
//
// KNOWN GAP, documented rather than solved: a cycle that was NEVER closed leaves no
// completion event, so skipped cycles are invisible unless reconstructed by walking the
// recurrence between known cycles. This tab undercounts rather than fabricating, which is
// the house rule.
//
// Fully rebuilt every run from `Completions` plus the live list, so it is idempotent and
// self-healing: a late completion, a corrected row upstream, or a re-run all converge on
// the same answer. That also means there is no separate backfill entry point — the
// nightly path already reaches all of history.
// ─────────────────────────────────────────────────────────────────────────────

const BILL_AREA = "bills-taxes";

const BILL_CYCLE_HEADER = [
	"bill", // A
	"task_id", // B
	"area", // C
	"project_name", // D
	"cycle", // E — YYYY-MM, from cycle_due_date
	"cycle_due_date", // F — the occurrence this row is about
	"closed_at", // G — local day it was checked off; blank while open
	"days_to_close", // H — due → close lag. Negative = closed early; measured
	//     against today while still open
	"status", // I — closed | closed_late | open | overdue
	"was_overdue", // J — Todoist's own flag; blank = unknown
	"is_recurring", // K
	"on_time_close_streak", // L — consecutive cycles CLOSED by their due date
];

function syncBillCycle() {
	const ss = SpreadsheetApp.openById(TODOIST_SPREADSHEET_ID);
	const sheet = getOrCreateBillCycleSheet(ss);
	const tree = getProjectTree();
	const liveTasks = todoistGetPaged("/tasks");
	const rows = buildBillCycleRows(ss, tree, liveTasks);

	// Full rebuild: clearContent() rather than deleteRows(), for the same reason
	// replaceHabitDailyRows() does it — Sheets refuses to delete every unfrozen row
	// once the header is frozen, which it is the moment anyone freezes it by hand.
	const lastRow = sheet.getLastRow();
	if (lastRow > 1) {
		sheet.getRange(
			2,
			1,
			lastRow - 1,
			BILL_CYCLE_HEADER.length,
		).clearContent();
	}
	if (rows.length > 0) {
		sheet.getRange(
			2,
			1,
			rows.length,
			BILL_CYCLE_HEADER.length,
		).setValues(rows);
	}
	Logger.log(`BillCycle: wrote ${rows.length} cycle rows`);
}

// Closed cycles from Completions, then the one open cycle per live bill, then streaks.
function buildBillCycleRows(ss, tree, liveTasks) {
	const today = localDateString(new Date());
	const cycles = {}; // task_id|cycle_due_date → row object
	const names = {}; // task_id → current name, from the live list
	let missingDue = 0;

	(liveTasks || []).forEach((t) => {
		names[String(t.id)] = t.content || "";
	});

	// ── Closed cycles ──────────────────────────────────────────────────
	const sheet = ss.getSheetByName("Completions");
	if (sheet && sheet.getLastRow() > 1) {
		const data = sheet.getDataRange().getValues();
		for (let i = 1; i < data.length; i++) {
			const row = data[i];
			// Prefer the stored area, but derive it when the column is
			// blank — this tab must work before backfillCompletionAreas()
			// has ever run.
			const stored = String(row[14] || "").trim();
			const area =
				stored ||
				areaOf(
					String(row[3] || ""),
					splitLabels(row[6]),
					tree,
				).area;
			if (area !== BILL_AREA) continue;

			const cycleDue = dateKey(row[9]).slice(0, 10);
			if (!cycleDue) {
				// No occurrence to attribute the cycle to. Counted, not
				// guessed at.
				missingDue++;
				continue;
			}
			const taskId = String(row[1] || "");
			const key = `${taskId}|${cycleDue}`;
			const closedAt = localDayOf(row[0]);

			// A cycle can appear twice if it was un-completed and re-completed.
			// The FIRST close is the one that answers "did this cycle close on
			// time", so keep the earliest.
			const existing = cycles[key];
			if (existing && existing.closed_at <= closedAt)
				continue;

			cycles[key] = {
				bill: names[taskId] || row[2] || "",
				task_id: taskId,
				project_name: row[4] || "",
				cycle_due_date: cycleDue,
				closed_at: closedAt,
				was_overdue: String(row[16] || "")
					.trim()
					.toUpperCase(),
				is_recurring:
					String(row[8] || "").toUpperCase() ===
					"TRUE"
						? "TRUE"
						: "FALSE",
			};
		}
	}

	// ── The open cycle ─────────────────────────────────────────────────
	(liveTasks || []).forEach((t) => {
		const pid = String(t.project_id || "");
		if (areaOf(pid, t.labels || [], tree).area !== BILL_AREA)
			return;
		const due =
			t.due && t.due.date
				? String(t.due.date).slice(0, 10)
				: "";
		if (!due) return; // an undated bill has no cycle to score
		const taskId = String(t.id);
		const key = `${taskId}|${due}`;
		// If this occurrence is already recorded as closed, the closed row wins.
		if (cycles[key]) return;
		cycles[key] = {
			bill: t.content || "",
			task_id: taskId,
			project_name: (tree[pid] && tree[pid].name) || "",
			cycle_due_date: due,
			closed_at: "",
			was_overdue: "",
			is_recurring:
				t.due && t.due.is_recurring ? "TRUE" : "FALSE",
		};
	});

	if (missingDue > 0) {
		Logger.log(
			`BillCycle: ${missingDue} bills-area completion(s) had no due_date and were skipped — ` +
				"they cannot be attributed to a cycle.",
		);
	}

	// ── Streaks, per bill, in cycle order ──────────────────────────────
	const byTask = {};
	Object.keys(cycles).forEach((k) => {
		const c = cycles[k];
		(byTask[c.task_id] = byTask[c.task_id] || []).push(c);
	});

	const rows = [];
	Object.keys(byTask)
		.sort((a, b) =>
			String(byTask[a][0].bill).localeCompare(
				String(byTask[b][0].bill),
			),
		)
		.forEach((taskId) => {
			const list = byTask[taskId].sort((a, b) =>
				a.cycle_due_date < b.cycle_due_date ? -1 : 1,
			);
			let streak = 0;
			list.forEach((c) => {
				const status = billCycleStatus(
					c.closed_at,
					c.cycle_due_date,
					c.was_overdue,
					today,
				);
				// closed → done, closed_late → missed, still-open →
				// carry. An unfinished cycle is not yet a failure,
				// exactly as a day in progress is not.
				streak = nextStreak(
					streak,
					status === "closed"
						? "done"
						: status === "closed_late"
							? "missed"
							: "pending",
				);
				rows.push([
					c.bill,
					c.task_id,
					BILL_AREA,
					c.project_name,
					c.cycle_due_date.slice(0, 7),
					c.cycle_due_date,
					c.closed_at,
					daysBetweenDays(
						c.cycle_due_date,
						c.closed_at || today,
					),
					status,
					c.was_overdue,
					c.is_recurring,
					streak,
				]);
			});
		});
	return rows;
}

// `closed` vs `closed_late` — did the cycle close by its due date. NOT a claim about when
// the bill was paid; see the file header.
//
// Todoist's `was_overdue` wins where present because it is TIMESTAMP-precise, while the
// date fallback is only DAY-precise. The two can legitimately disagree on a same-day close:
// a task due 02:00 and ticked at 09:00 the same day is `was_overdue = TRUE` but zero days
// late. Trusting the flag first keeps the answer consistent with what Todoist itself shows.
//
// A blank `was_overdue` means UNKNOWN — it falls through to the dates rather than
// defaulting to `closed`, so an unverifiable row is never quietly scored as on time.
//
// `open` / `overdue` describe the LIVE state of an unticked cycle and are unchanged: they
// make no claim about payment, only about whether the task is past its due date right now.
function billCycleStatus(closedAt, cycleDueDate, wasOverdue, today) {
	if (closedAt) {
		if (wasOverdue === "TRUE") return "closed_late";
		if (wasOverdue === "FALSE") return "closed";
		const lag = daysBetweenDays(cycleDueDate, closedAt);
		return lag !== "" && lag > 0 ? "closed_late" : "closed";
	}
	const over = daysBetweenDays(cycleDueDate, today);
	return over !== "" && over > 0 ? "overdue" : "open";
}

function getOrCreateBillCycleSheet(ss) {
	let sheet = ss.getSheetByName("BillCycle");
	if (!sheet) {
		sheet = ss.insertSheet("BillCycle");
		writeBillCycleHeader(sheet);
		return sheet;
	}
	const existing = sheet.getLastColumn()
		? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
		: [];
	if (existing.join("|") !== BILL_CYCLE_HEADER.join("|")) {
		// Safe to wipe: every row here is DERIVED from Completions plus the live
		// list, so the next run rebuilds all of it. Nothing is observed-only.
		Logger.log(
			`BillCycle: layout changed (${existing.length} cols → ${BILL_CYCLE_HEADER.length}); clearing and rebuilding.`,
		);
		sheet.clear();
		writeBillCycleHeader(sheet);
	}
	return sheet;
}

function writeBillCycleHeader(sheet) {
	sheet.getRange(1, 1, 1, BILL_CYCLE_HEADER.length).setValues([
		BILL_CYCLE_HEADER,
	]);
}

// ── Morning risk check ─────────────────────────────────────────────────────

// The trigger that would actually have caught the 24-day-late internet bill. Read-only:
// it reports, it does not write. Wire it to a morning time trigger.
const BILL_RISK_HORIZON_DAYS = 5;

function checkBillRisk() {
	const tree = getProjectTree();
	const today = localDateString(new Date());
	const tasks = todoistGetPaged("/tasks");
	const overdue = [];
	const soon = [];

	tasks.forEach((t) => {
		if (
			areaOf(String(t.project_id || ""), t.labels || [], tree)
				.area !== BILL_AREA
		)
			return;
		const due =
			t.due && t.due.date
				? String(t.due.date).slice(0, 10)
				: "";
		if (!due) return;
		const days = daysBetweenDays(today, due);
		if (days === "") return;
		if (days < 0)
			overdue.push(
				`${t.content} — ${-days}d overdue (due ${due})`,
			);
		else if (days <= BILL_RISK_HORIZON_DAYS)
			soon.push(`${t.content} — due in ${days}d (${due})`);
	});

	// Sorted by urgency, never by priority: every recurring bill is p1.
	Logger.log(`Bill risk on ${today}`);
	logAreaList("OVERDUE NOW", overdue);
	logAreaList(`Due within ${BILL_RISK_HORIZON_DAYS} days`, soon);
	if (overdue.length === 0 && soon.length === 0) {
		Logger.log("Nothing overdue and nothing due soon.");
	}
}
