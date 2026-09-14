// ─────────────────────────────────────────────────────────────────────────────
// Logger — the run's narration
//
// 96 Logger.log calls across the ten legacy files, and they are not decoration:
// with no test coverage on the .gs, the executions dashboard IS the observability
// story. A run that logs "Completions: 14 new, 3 duplicates skipped" is how you
// find out a source went quiet.
//
// Note what is NOT here: no levels, no error(). Failures travel as thrown
// exceptions, because an Apps Script trigger surfaces a throw in the executions
// dashboard and does nothing at all with a logged string. Adding an error()
// here would offer a way to record a failure that nobody is watching — the
// orchestrator deliberately collects step failures and rethrows at the end for
// exactly that reason.
// ─────────────────────────────────────────────────────────────────────────────

export interface Logger {
	log(message: string): void;
}
