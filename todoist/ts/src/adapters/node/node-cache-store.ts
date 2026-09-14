// CacheStore over an in-process Map.
//
// A GitHub Actions run is a fresh process that lives for a minute or two, so a
// 6-hour TTL is meaningless: the cache starts empty every time and dies with
// the run. The whole cost of that is one /projects and one /sections call per
// run, which is why the plan chose this over anything durable.
//
// The TTL is still honoured rather than ignored. A long-running local CLI
// session is the case where it matters, and an adapter that silently kept a
// stale project tree for ever would be a confusing thing to debug.
//
// No 100KB limit here — that cap is CacheService's, not a fact about caching.

import type { CacheStore } from "../../ports/cache-store.ts";

export function createNodeCacheStore(now: () => number = Date.now): CacheStore {
	const entries = new Map<string, { value: string; expiresAt: number }>();

	return {
		read(key: string): string | null {
			const entry = entries.get(key);
			if (!entry) return null;
			if (entry.expiresAt <= now()) {
				entries.delete(key);
				return null;
			}
			return entry.value;
		},

		write(key: string, value: string, ttlSeconds: number): void {
			entries.set(key, {
				value,
				expiresAt: now() + ttlSeconds * 1000,
			});
		},
	};
}
