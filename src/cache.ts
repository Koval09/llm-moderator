import { Verdict, ModerationCache } from "./types.js";

export function normalizeText(text: string): string {
  let s = text.toLowerCase().trim();
  s = s.replace(/\s+/g, " ");
  // Collapse 3 or more repeating characters to two
  s = s.replace(/(.)\1{2,}/g, "$1$1");
  // Remove non-alphanumeric characters (Unicode-safe for all languages) and punctuation
  s = s.replace(/[^\p{L}\p{N}\s]/gu, "");
  return s.trim().replace(/\s+/g, " ");
}

interface CacheEntry {
  verdict: Verdict;
  expiry: number;
}

export function memoryCache(options: { ttlMs: number; maxEntries?: number }): ModerationCache {
  const cache = new Map<string, CacheEntry>();
  const { ttlMs, maxEntries } = options;

  return {
    get(key: string): Verdict | null {
      const entry = cache.get(key);
      if (!entry) {
        return null;
      }
      if (Date.now() > entry.expiry) {
        cache.delete(key);
        return null;
      }
      return entry.verdict;
    },
    set(key: string, value: Verdict): void {
      // Delete first to refresh insertion order for LRU/FIFO eviction
      cache.delete(key);

      const expiry = Date.now() + ttlMs;
      cache.set(key, { verdict: value, expiry });

      if (maxEntries !== undefined && cache.size > maxEntries) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) {
          cache.delete(oldestKey);
        }
      }
    },
  };
}
