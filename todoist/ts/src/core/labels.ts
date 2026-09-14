// ─────────────────────────────────────────────────────────────────────────────
// Labels
//
// Labels arrive in two shapes and both are legitimate: the Todoist API hands
// back an array, and a sheet cell holds a comma-joined string. Callers exist on
// both sides — a pipeline reading live tasks, and one re-reading a tab it wrote
// last night — so every function here accepts either.
// ─────────────────────────────────────────────────────────────────────────────

// Normalise either shape to a trimmed list, dropping empties.
//
// The filter matters more than it looks: a trailing comma in a cell ("a,b,")
// would otherwise produce an empty label that matches nothing and quietly
// changes a count.
export function toLabelList(labels: unknown): string[] {
	if (Array.isArray(labels)) {
		return labels
			.map((label) => String(label).trim())
			.filter((label) => label !== "");
	}
	if (labels === null || labels === undefined) return [];
	return String(labels)
		.split(",")
		.map((label) => label.trim())
		.filter((label) => label !== "");
}

export function hasLabel(labels: unknown, label: string): boolean {
	return toLabelList(labels).includes(label);
}

// Story points, as the first label that is ONLY digits.
//
// e.g. ["high-priority", "5", "backend"] → 5. Returns null rather than 0 for a
// task with no such label, because "no estimate" and "estimated at zero" are
// different facts and averaging them together would flatter the numbers.
export function extractComplexity(labels: unknown): number | null {
	const numeric = toLabelList(labels).find((label) =>
		/^\d+$/.test(label),
	);
	return numeric === undefined ? null : Number.parseInt(numeric, 10);
}

// "Drink Water - Drink water early in the morning" → "Drink Water".
//
// Splits on the FIRST " - " only, and only when the hyphen is surrounded by
// whitespace, so a genuinely hyphenated title ("Work-life balance") is left
// alone. Titles with no separator pass through unchanged.
export function shortHabitName(content: unknown): string {
	const text = String(content ?? "").trim();
	const match = text.match(/^(.*?)\s+-\s+/);
	return match?.[1] ? match[1].trim() : text;
}
