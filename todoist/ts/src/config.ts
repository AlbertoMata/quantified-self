// ─────────────────────────────────────────────────────────────────────────────
// Configuration — read explicitly, never defaulted
//
// Every runtime keeps its settings somewhere different: Script Properties under
// Apps Script, environment variables under GitHub Actions. This module does not
// know or care which — it takes a lookup function and enforces one rule on top
// of it: a missing setting throws.
//
// That rule is load-bearing, not defensive. A spreadsheet ID that silently falls
// back to a default is how a test run becomes an incident, and the tabs this
// project writes include two whose history cannot be re-fetched from anywhere.
// Failing closed turns that class of accident into an error message.
// ─────────────────────────────────────────────────────────────────────────────

// A settings source. Returns null/undefined for keys it does not hold, which is
// how both Script Properties and process.env already behave.
export type SettingLookup = (key: string) => string | null | undefined;

// Read a required setting, or throw explaining what to set and where.
export function requireSetting(lookup: SettingLookup, key: string): string {
	const rawValue = lookup(key);
	if (
		rawValue === null ||
		rawValue === undefined ||
		rawValue.trim() === ""
	) {
		throw new Error(
			`Missing required setting "${key}". Nothing here defaults to a live ` +
				`spreadsheet on purpose — set it explicitly for this runtime ` +
				`(Script Properties under Apps Script, environment variables under Node).`,
		);
	}
	return rawValue.trim();
}

// Read an optional setting, falling back to an explicit default supplied by the
// caller. Use this only where a default is genuinely harmless — never for a
// spreadsheet ID, an API token, or anything else that selects a write target.
export function readSetting(
	lookup: SettingLookup,
	key: string,
	fallback: string,
): string {
	const rawValue = lookup(key);
	if (
		rawValue === null ||
		rawValue === undefined ||
		rawValue.trim() === ""
	) {
		return fallback;
	}
	return rawValue.trim();
}
