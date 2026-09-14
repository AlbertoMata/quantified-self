// ─────────────────────────────────────────────────────────────────────────────
// CacheStore over CacheService
//
// A miss is normal, not an error: CacheService evicts under pressure whatever
// the TTL says. Everything above this treats null as "fetch it again".
//
// ⚠️ 100KB per value, and CacheService FAILS SILENTLY above it — the put is
// dropped and the next get simply misses, for ever. A permanent silent cache
// miss is a performance bug nobody would ever find, so this adapter checks the
// size and says so instead. It is why the live task map is not cached today.
// ─────────────────────────────────────────────────────────────────────────────

import type { CacheStore } from "../../ports/cache-store.ts";
import type { GasCacheService } from "./gas-types.ts";

// CacheService's documented per-value limit.
const MAX_VALUE_BYTES = 100 * 1024;

export function createGasCacheStore(cacheService: GasCacheService): CacheStore {
	const cache = cacheService.getScriptCache();

	return {
		read(key: string): string | null {
			return cache.get(key);
		},

		write(key: string, value: string, ttlSeconds: number): void {
			// Byte length, not string length: a project name with an emoji in
			// it costs four bytes per character, and the area tree is full of
			// them (💼 Work).
			const bytes = byteLength(value);
			if (bytes > MAX_VALUE_BYTES) {
				throw new Error(
					`Cache value for "${key}" is ${bytes} bytes, over CacheService's ` +
						`${MAX_VALUE_BYTES}-byte limit. CacheService would drop this ` +
						`silently and every later read would miss, which is a ` +
						`performance bug with no symptom. Cache less, or do not cache it.`,
				);
			}
			cache.put(key, value, ttlSeconds);
		},
	};
}

// No TextEncoder on the Apps Script V8 runtime, so count UTF-8 bytes directly.
function byteLength(value: string): number {
	let bytes = 0;
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0;
		if (codePoint <= 0x7f) bytes += 1;
		else if (codePoint <= 0x7ff) bytes += 2;
		else if (codePoint <= 0xffff) bytes += 3;
		else bytes += 4;
	}
	return bytes;
}
