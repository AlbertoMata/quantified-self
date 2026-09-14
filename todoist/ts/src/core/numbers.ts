// ─────────────────────────────────────────────────────────────────────────────
// Numbers
//
// The legacy `num()`, renamed to say what it does. It is used where a missing
// value must not poison an arithmetic chain — a blank karma cell should read as
// zero rather than turn a running total into NaN and blank an entire column.
// ─────────────────────────────────────────────────────────────────────────────

// A value as a number, or 0 when it is not one.
//
// Note "" → 0, matching Number(""). That is deliberate here: the callers are
// summing sheet columns where a blank cell genuinely means none. Anywhere the
// DIFFERENCE between "absent" and "zero" matters — an estimate, a duration —
// use toNumberOrNull instead.
export function toNumberOrZero(value: unknown): number {
	const parsed = Number(value);
	return Number.isNaN(parsed) ? 0 : parsed;
}

// A value as a number, or null when it is absent or not numeric.
//
// The honest counterpart. `AreaDaily` distinguishes an observed zero from an
// unobserved day with `counts_observed` for exactly this reason: a zero you
// measured and a zero you invented are not the same row.
export function toNumberOrNull(value: unknown): number | null {
	if (value === null || value === undefined || value === "") return null;
	const parsed = Number(value);
	return Number.isNaN(parsed) ? null : parsed;
}

// A Todoist duration object {amount, unit} as whole minutes, or null.
export function durationMinutes(duration: unknown): number | null {
	if (!duration || typeof duration !== "object") return null;
	const record = duration as { amount?: unknown; unit?: unknown };
	const amount = toNumberOrNull(record.amount);
	if (amount === null || amount === 0) return null;
	return Math.round(amount * (record.unit === "hour" ? 60 : 1));
}
