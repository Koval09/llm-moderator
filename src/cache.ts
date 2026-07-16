import { Verdict, ModerationCache } from "./types.js";

export function normalizeText(text: string): string {
  let s = text.toLowerCase().trim();
  s = s.replace(/\s+/g, " ");
  // Collapse repeating characters
  s = s.replace(/(.)\1+/g, "$1");
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
      const normalized = normalizeText(key);
      const entry = cache.get(normalized);
      if (!entry) {
        return null;
      }
      if (Date.now() > entry.expiry) {
        cache.delete(normalized);
        return null;
      }
      return entry.verdict;
    },
    set(key: string, value: Verdict): void {
      const normalized = normalizeText(key);

      // Delete first to refresh insertion order for LRU/FIFO eviction
      cache.delete(normalized);

      const expiry = Date.now() + ttlMs;
      cache.set(normalized, { verdict: value, expiry });

      if (maxEntries !== undefined && cache.size > maxEntries) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) {
          cache.delete(oldestKey);
        }
      }
    },
  };
}
