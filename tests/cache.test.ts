import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memoryCache, normalizeText } from "../src/cache.js";
import { createModerator } from "../src/moderator.js";
import { mockProvider } from "../src/providers/mock.js";

describe("Cache", () => {
  describe("normalizeText", () => {
    it("normalizes cases, spaces, repeated characters and punctuation", () => {
      expect(normalizeText("Привет!!!")).toBe("привет");
      expect(normalizeText("привет")).toBe("привет");
      expect(normalizeText("  HELLO   world!!!  ")).toBe("helo world");
      expect(normalizeText("wwoorrllldd")).toBe("world");
    });
  });

  describe("memoryCache unit tests", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("handles hit/miss and TTL expiration", async () => {
      const cache = memoryCache({ ttlMs: 1000 });
      const verdict = { action: "allow", confidence: 0.95, source: "primary" } as const;

      expect(await cache.get("test")).toBeNull();

      await cache.set("test", verdict);
      expect(await cache.get("test")).toEqual(verdict);

      // Fast forward 500ms
      vi.advanceTimersByTime(500);
      expect(await cache.get("test")).toEqual(verdict);

      // Fast forward another 600ms (total 1100ms)
      vi.advanceTimersByTime(600);
      expect(await cache.get("test")).toBeNull();
    });

    it("collapses similar texts to the same cache key", async () => {
      const cache = memoryCache({ ttlMs: 1000 });
      const verdict = { action: "block", confidence: 0.8, source: "primary" } as const;

      await cache.set("Привет!!!", verdict);
      expect(await cache.get("привет")).toEqual(verdict);
    });

    it("respects maxEntries eviction of oldest entries", async () => {
      const cache = memoryCache({ ttlMs: 1000, maxEntries: 2 });
      const v1 = { action: "allow", confidence: 0.1, source: "primary" } as const;
      const v2 = { action: "allow", confidence: 0.2, source: "primary" } as const;
      const v3 = { action: "allow", confidence: 0.3, source: "primary" } as const;

      await cache.set("one", v1);
      await cache.set("two", v2);
      expect(await cache.get("one")).toEqual(v1);

      await cache.set("three", v3); // should evict "one" since maxEntries is 2 and "one" is oldest
      expect(await cache.get("one")).toBeNull();
      expect(await cache.get("two")).toEqual(v2);
      expect(await cache.get("three")).toEqual(v3);
    });
  });

  describe("Integration with Moderator", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("caches successful verdicts and returns with source: cache", async () => {
      let apiCalls = 0;
      const provider = mockProvider({
        clean: { action: "allow", confidence: 0.99 },
      });

      const originalModerateBatch = provider.moderateBatch;
      provider.moderateBatch = async (texts, policy) => {
        apiCalls++;
        return originalModerateBatch(texts, policy);
      };

      const cache = memoryCache({ ttlMs: 1000 });
      const moderator = createModerator({
        provider,
        policy: { block: [] },
        cache,
      });

      // Call 1: Miss, goes to provider
      const res1 = await moderator.check({ text: "clean" });
      expect(res1).toEqual({ action: "allow", confidence: 0.99, source: "primary" });
      expect(apiCalls).toBe(1);

      // Call 2: Hit, returns from cache
      const res2 = await moderator.check({ text: "clean" });
      expect(res2).toEqual({ action: "allow", confidence: 0.99, source: "cache" });
      expect(apiCalls).toBe(1); // Still 1

      // Stats check
      const stats = moderator.stats();
      expect(stats.checked).toBe(2);
      expect(stats.cacheHits).toBe(1);
      expect(stats.apiCalls).toBe(1);
    });

    it("does not cache error-fallback", async () => {
      const primary = mockProvider({ broken: "error" });
      const cache = memoryCache({ ttlMs: 1000 });
      const moderator = createModerator({
        provider: primary,
        policy: { block: [] },
        cache,
        onError: "block",
      });

      // Call 1: fails, falls back to error-fallback
      const res1 = await moderator.check({ text: "broken" });
      expect(res1).toEqual({ action: "block", confidence: 0, source: "error-fallback" });

      // Call 2: should miss again since we don't cache error-fallback
      const res2 = await moderator.check({ text: "broken" });
      expect(res2).toEqual({ action: "block", confidence: 0, source: "error-fallback" });

      const stats = moderator.stats();
      expect(stats.checked).toBe(2);
      expect(stats.cacheHits).toBe(0);
      expect(stats.errors).toBe(4); // 2 attempts per call
    });
  });
});
