// ─────────────────────────────────────────────────────────────────────────────
// SettingLookup — configuration, which crosses the seam like everything else
//
// Every runtime keeps its settings somewhere different: Script Properties under
// Apps Script, environment variables under a GitHub runner. A pipeline needs the
// Todoist token and the timezone and should know about neither mechanism.
//
// It is a bare function rather than an interface because there is exactly one
// operation, and because both platforms already expose that shape — a reader
// that returns null for what it does not hold.
//
// The fail-closed rule lives one level up in config.ts: this port can return
// null, and requireSetting is what turns that into an error rather than a
// silent default pointing at production.
// ─────────────────────────────────────────────────────────────────────────────

export type SettingLookup = (key: string) => string | null | undefined;
