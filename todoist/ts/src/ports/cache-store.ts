// ─────────────────────────────────────────────────────────────────────────────
// CacheStore — a speed optimisation, never a source of truth
//
// Holds two derived maps: project id → name, and the project tree used to
// resolve a task's life area. Both are rebuilt from the Todoist API on a miss,
// so an empty cache costs two extra HTTP calls and changes no output.
//
// Everything here must tolerate returning null at any moment. Apps Script's
// CacheService evicts under pressure regardless of TTL, and under GitHub
// Actions the adapter is an in-process Map that starts empty every run — a
// 6-hour TTL is meaningless to a process that lives for ninety seconds.
//
// ⚠️ CacheService caps a value at 100KB, which is why the live task map is not
// cached today. An adapter that silently drops an oversized put would make a
// cache miss permanent and invisible; it should surface that instead.
// ─────────────────────────────────────────────────────────────────────────────

export interface CacheStore {
	read(key: string): string | null;

	// ttlSeconds is required, with no default, because the legacy 6-hour value
	// (21600) was chosen against how often a Todoist project gets renamed. A
	// default here would be one implementation's opinion imposed on both.
	write(key: string, value: string, ttlSeconds: number): void;
}
