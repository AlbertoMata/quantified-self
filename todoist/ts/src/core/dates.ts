// ─────────────────────────────────────────────────────────────────────────────
// Dates — where the duplicate toDateString() finally dies
//
// The live editor defines `toDateString` twice and `localDayOf` twice, in two
// files each, because a flat global scope makes that possible and nothing
// reports it. One definition each, here.
//
// THE RULE THIS MODULE EXISTS TO ENFORCE: there is no ambient timezone. The
// legacy code reaches for `Session.getScriptTimeZone()` inside the formatter,
// which works only because Apps Script happens to have one. A GitHub runner is
// UTC and has none, so the zone becomes an explicit argument and formatting a
// day becomes a pure function of (instant, timezone) — testable, and identical
// on both runtimes.
//
// THE BUG THIS PREVENTS is recorded in todoist/history.md for 2026-08-20.
// `toISOString()` renders in UTC, so in a UTC-behind zone an evening run reads
// TOMORROW's UTC date as "today": rescheduled tasks land a day late and evening
// habit completions file on the wrong day. Both formatters below still exist —
// the distinction is real — but the local one now says which zone it means.
// ─────────────────────────────────────────────────────────────────────────────

// A calendar day, as YYYY-MM-DD. A named type because almost every function
// here takes or returns one, and "string" says nothing about the shape.
export type DayKey = string;

// The day an instant falls on in UTC.
//
// Correct for anything that IS UTC — a Todoist timestamp compared against
// another Todoist timestamp. Wrong for anything a human would call "today":
// use formatDayInTimezone for that.
export function formatUtcDay(instant: Date): DayKey {
	if (Number.isNaN(instant.getTime())) return "";
	return instant.toISOString().slice(0, 10);
}

// The day an instant falls on in a named timezone.
//
// Intl.DateTimeFormat rather than Utilities.formatDate: it is standard, it
// exists on both runtimes, and it needs no platform. `en-CA` is not an arbitrary
// locale — it formats as YYYY-MM-DD, which is exactly the key shape, so no
// reassembly from parts is needed.
export function formatDayInTimezone(instant: Date, timezone: string): DayKey {
	if (Number.isNaN(instant.getTime())) return "";
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(instant);
}

// Todoist's datetime format: YYYY-MM-DDTHH:MM:SS, no milliseconds, no trailing Z.
export function formatTodoistDateTime(instant: Date): string {
	return instant.toISOString().slice(0, 19);
}

// Normalise whatever a sheet cell holds into a day key.
//
// Sheets returns a real Date once a cell is date-formatted, so `=== "2026-05-26"`
// silently misses. This is what stops that, and it is the reason `CellValue`
// admits a Date at all.
//
// NOTE it formats in UTC, matching the legacy `dateKey`. That is correct for the
// keys it compares, which were themselves written as UTC day strings — but it is
// why the write-plan tests pin that a Date cell must NOT match a day-key string
// by accident. Use cellValueToLocalDay where a human calendar day is meant.
export function cellValueToDayKey(cellValue: unknown): DayKey {
	if (cellValue instanceof Date) return formatUtcDay(cellValue);
	if (cellValue === null || cellValue === undefined) return "";
	return String(cellValue);
}

// A stored timestamp as a calendar day in a named timezone.
//
// The legacy `localDayOf`, with the ambient zone made explicit. Stored values
// are UTC, so an event at 20:00 in a UTC-6 zone carries the FOLLOWING UTC date —
// formatting it as UTC files every evening event a day late.
export function cellValueToLocalDay(
	cellValue: unknown,
	timezone: string,
): DayKey {
	if (cellValue === null || cellValue === undefined || cellValue === "") {
		return "";
	}
	const instant =
		cellValue instanceof Date
			? cellValue
			: new Date(String(cellValue));
	if (Number.isNaN(instant.getTime())) return "";
	return formatDayInTimezone(instant, timezone);
}

// Whole days from one calendar day to another: positive when `toDay` is later.
//
// Both ends are anchored to UTC midnight deliberately. Subtracting two LOCAL
// dates across a DST change yields 23 or 25 hours and rounds to the wrong day;
// anchoring to UTC makes the span exact whatever the zone does. Mexico City has
// had no DST since 2022, so this is protection against a zone changing its mind
// rather than against today's calendar.
//
// Inputs are sliced to 10 characters, so a floating due datetime
// ("2026-09-15T11:00:00") works as well as a plain day. Returns null rather than
// NaN when either end is missing or unparseable, so a blank due date propagates
// as a blank cell instead of poisoning a sum.
export function daysBetweenDays(
	fromDay: string | null | undefined,
	toDay: string | null | undefined,
): number | null {
	const from = String(fromDay ?? "").slice(0, 10);
	const to = String(toDay ?? "").slice(0, 10);
	if (!from || !to) return null;

	const fromInstant = new Date(`${from}T00:00:00Z`);
	const toInstant = new Date(`${to}T00:00:00Z`);
	if (
		Number.isNaN(fromInstant.getTime()) ||
		Number.isNaN(toInstant.getTime())
	) {
		return null;
	}
	return Math.round(
		(toInstant.getTime() - fromInstant.getTime()) / 86_400_000,
	);
}

// Shift a calendar day by whole days, staying in day-key space.
//
// Distinct from the legacy `addDays`, which shifted a Date using local calendar
// arithmetic. Working in day keys removes the question entirely: there is no
// instant involved, so there is no zone to get wrong and no DST edge to land on.
export function addDaysToDay(day: DayKey, days: number): DayKey {
	const anchor = new Date(`${day.slice(0, 10)}T00:00:00Z`);
	if (Number.isNaN(anchor.getTime())) return "";
	anchor.setUTCDate(anchor.getUTCDate() + days);
	return formatUtcDay(anchor);
}

// Is this a well-formed calendar day?
//
// Checks the value as well as the shape: "2026-02-30" matches the pattern and is
// not a date. Used at the edges, where a day key arrives from a sheet cell
// someone may have typed into.
export function isValidDayKey(day: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
	const parsed = new Date(`${day}T00:00:00Z`);
	return !Number.isNaN(parsed.getTime()) && formatUtcDay(parsed) === day;
}
