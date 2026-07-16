import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createModerator } from "../src/moderator.js";
import { mockProvider } from "../src/providers/mock.js";
import { ModerationProvider, ModerationAction } from "../src/types.js";
import { memoryCache } from "../src/cache.js";

describe("Moderator", () => {
  const defaultPolicy = {
    block: ["slurs", "threats"],
  };

  it("returns correct verdict on successful primary check (source: primary)", async () => {
    const primary = mockProvider({
      hello: { action: "allow", confidence: 0.99 },
    });

    const moderator = createModerator({
      provider: primary,
      policy: defaultPolicy,
    });

    const result = await moderator.check({ text: "hello" });
    expect(result).toEqual({
      action: "allow",
      category: undefined,
      confidence: 0.99,
      source: "primary",
    });

    const stats = moderator.stats();
    expect(stats.checked).toBe(1);
    expect(stats.apiCalls).toBe(1);
    expect(stats.errors).toBe(0);
    expect(stats.estimatedInputTokens).toBeGreaterThan(0);
    expect(stats.estimatedOutputTokens).toBe(20);
  });

  it("retries once after invalid JSON/malformed response and succeeds on second try", async () => {
    let callCount = 0;
    const transientProvider: ModerationProvider = {
      name: "transient-provider",
      async moderateBatch(_texts, _compiledPolicy) {
        callCount++;
        if (callCount === 1) {
          return [{ action: "invalid-action" as unknown as ModerationAction, confidence: -1 }];
        }
        return [{ action: "allow", confidence: 0.9 }];
      },
    };

    const moderator = createModerator({
      provider: transientProvider,
      policy: defaultPolicy,
    });

    const result = await moderator.check({ text: "hello" });
    expect(result).toEqual({
      action: "allow",
      category: undefined,
      confidence: 0.9,
      source: "primary",
    });

    const stats = moderator.stats();
    expect(stats.checked).toBe(1);
    expect(stats.apiCalls).toBe(2);
    expect(stats.errors).toBe(1);
  });

  it("switches to the second provider on error of the first (source: fallback-provider)", async () => {
    const primary = mockProvider({
      hello: "error",
    });
    const fallback = mockProvider({
      hello: { action: "allow", confidence: 0.8 },
    });

    const moderator = createModerator({
      provider: primary,
      fallbackProviders: [fallback],
      policy: defaultPolicy,
    });

    const result = await moderator.check({ text: "hello" });
    expect(result).toEqual({
      action: "allow",
      category: undefined,
      confidence: 0.8,
      source: "fallback-provider",
    });

    const stats = moderator.stats();
    expect(stats.checked).toBe(1);
    expect(stats.apiCalls).toBe(3); // 2 primary + 1 fallback
    expect(stats.fallbackProviderCalls).toBe(1);
    expect(stats.errors).toBe(2);
  });

  it("respects the correct order of fallback providers", async () => {
    const primary = mockProvider({ hello: "error" });
    const fallback1 = mockProvider({ hello: "error" }, { name: "fb1" });
    const fallback2 = mockProvider(
      { hello: { action: "block", category: "slurs", confidence: 0.95 } },
      { name: "fb2" }
    );
    const fallback3 = mockProvider(
      { hello: { action: "allow", confidence: 1.0 } },
      { name: "fb3" }
    );

    const moderator = createModerator({
      provider: primary,
      fallbackProviders: [fallback1, fallback2, fallback3],
      policy: defaultPolicy,
    });

    const result = await moderator.check({ text: "hello" });
    expect(result).toEqual({
      action: "block",
      category: "slurs",
      confidence: 0.95,
      source: "fallback-provider",
    });

    const stats = moderator.stats();
    expect(stats.checked).toBe(1);
    expect(stats.apiCalls).toBe(5); // 2 primary + 2 fallback1 + 1 fallback2
    expect(stats.fallbackProviderCalls).toBe(3);
    expect(stats.errors).toBe(4);
  });

  it("triggers onError fallback after all providers fail (fail-open vs fail-closed)", async () => {
    const primary = mockProvider({ hello: "error" });
    const fallback = mockProvider({ hello: "error" });

    const moderatorOpen = createModerator({
      provider: primary,
      fallbackProviders: [fallback],
      policy: defaultPolicy,
      onError: "allow",
    });

    const resultOpen = await moderatorOpen.check({ text: "hello" });
    expect(resultOpen).toEqual({
      action: "allow",
      confidence: 0,
      source: "error-fallback",
    });

    const moderatorClosed = createModerator({
      provider: primary,
      fallbackProviders: [fallback],
      policy: defaultPolicy,
      onError: "block",
    });

    const resultClosed = await moderatorClosed.check({ text: "hello" });
    expect(resultClosed).toEqual({
      action: "block",
      confidence: 0,
      source: "error-fallback",
    });

    const stats = moderatorClosed.stats();
    expect(stats.errors).toBe(4);
  });

  describe("Escalation", () => {
    it("escalates when confidence is below threshold and returns escalation source", async () => {
      const primary = mockProvider({
        maybeBad: { action: "flag", confidence: 0.5 },
      });
      const escalationTo = mockProvider({
        maybeBad: { action: "block", category: "slurs", confidence: 0.95 },
      });

      const moderator = createModerator({
        provider: primary,
        policy: defaultPolicy,
        escalation: {
          toProvider: escalationTo,
          whenConfidenceBelow: 0.8,
        },
      });

      const result = await moderator.check({ text: "maybeBad" });
      expect(result).toEqual({
        action: "block",
        category: "slurs",
        confidence: 0.95,
        source: "escalation",
      });

      const stats = moderator.stats();
      expect(stats.checked).toBe(1);
      expect(stats.apiCalls).toBe(2); // 1 primary + 1 escalation
      expect(stats.escalations).toBe(1);
      expect(stats.fallbackProviderCalls).toBe(0);
    });

    it("does not escalate when confidence is at or above threshold", async () => {
      const primary = mockProvider({
        sureGood: { action: "allow", confidence: 0.8 },
      });
      const escalationTo = mockProvider({
        sureGood: { action: "block", confidence: 0.95 },
      });

      const moderator = createModerator({
        provider: primary,
        policy: defaultPolicy,
        escalation: {
          toProvider: escalationTo,
          whenConfidenceBelow: 0.8,
        },
      });

      const result = await moderator.check({ text: "sureGood" });
      expect(result).toEqual({
        action: "allow",
        category: undefined,
        confidence: 0.8,
        source: "primary",
      });

      const stats = moderator.stats();
      expect(stats.checked).toBe(1);
      expect(stats.apiCalls).toBe(1); // Only primary
      expect(stats.escalations).toBe(0);
    });

    it("keeps primary verdict if the escalation provider fails", async () => {
      const primary = mockProvider({
        maybeBad: { action: "flag", confidence: 0.5 },
      });
      const escalationTo = mockProvider({
        maybeBad: "error",
      });

      const moderator = createModerator({
        provider: primary,
        policy: defaultPolicy,
        escalation: {
          toProvider: escalationTo,
          whenConfidenceBelow: 0.8,
        },
      });

      const result = await moderator.check({ text: "maybeBad" });
      // Remains primary verdict
      expect(result).toEqual({
        action: "flag",
        category: undefined,
        confidence: 0.5,
        source: "primary",
      });

      const stats = moderator.stats();
      expect(stats.checked).toBe(1);
      expect(stats.apiCalls).toBe(3); // 1 primary + 2 escalation attempts (initial + retry)
      expect(stats.escalations).toBe(1);
      expect(stats.errors).toBe(2); // 2 escalation failures
    });
  });

  describe("Statistics collection sequence", () => {
    it("accumulates all stats correctly across different scenarios", async () => {
      const primary = mockProvider({
        clean: { action: "allow", confidence: 0.95 },
        suspicious: { action: "flag", confidence: 0.4 },
        broken: "error",
        ultimateFail: "error",
      });

      const fallback = mockProvider({
        broken: { action: "allow", confidence: 0.8 },
        ultimateFail: "error",
      });

      const escalationTo = mockProvider({
        suspicious: { action: "block", confidence: 0.99 },
      });

      const cache = memoryCache({ ttlMs: 1000 });

      const moderator = createModerator({
        provider: primary,
        fallbackProviders: [fallback],
        escalation: {
          toProvider: escalationTo,
          whenConfidenceBelow: 0.8,
        },
        cache,
        policy: defaultPolicy,
        onError: "block",
      });

      // 1. Success check (primary) -> write to cache
      const r1 = await moderator.check({ text: "clean" });
      expect(r1.source).toBe("primary");

      // 2. Cache hit (cached)
      const r2 = await moderator.check({ text: "clean" });
      expect(r2.source).toBe("cache");

      // 3. Escalated check (primary -> escalation) -> write to cache
      const r3 = await moderator.check({ text: "suspicious" });
      expect(r3.source).toBe("escalation");

      // 4. Primary fail -> Fallback success -> write to cache
      const r4 = await moderator.check({ text: "broken" });
      expect(r4.source).toBe("fallback-provider");

      // 5. Ultimate fail -> all fail -> onError -> do NOT write to cache
      const r5 = await moderator.check({ text: "ultimateFail" });
      expect(r5.source).toBe("error-fallback");

      const stats = moderator.stats();

      expect(stats.checked).toBe(5);
      expect(stats.cacheHits).toBe(1);
      // Calls details:
      // Scenario 1: 1 call to primary
      // Scenario 2: 0 calls (cache hit)
      // Scenario 3: 1 call to primary + 1 call to escalation = 2 calls
      // Scenario 4: 2 calls to primary (fail, retry) + 1 call to fallback = 3 calls
      // Scenario 5: 2 calls to primary (fail, retry) + 2 calls to fallback (fail, retry) = 4 calls
      // Total API calls = 1 + 0 + 2 + 3 + 4 = 10
      expect(stats.apiCalls).toBe(10);
      expect(stats.batches).toBe(0); // batch not configured
      expect(stats.escalations).toBe(1);
      // Fallback calls:
      // Scenario 4: 1 call
      // Scenario 5: 2 calls
      // Total = 3 fallback provider calls
      expect(stats.fallbackProviderCalls).toBe(3);
      // Errors details:
      // Scenario 4: 2 errors (primary failed twice)
      // Scenario 5: 2 errors (primary failed twice) + 2 errors (fallback failed twice) = 4 errors
      // Total errors = 2 + 4 = 6
      expect(stats.errors).toBe(6);
      expect(stats.cacheErrors).toBe(0);

      expect(stats.estimatedInputTokens).toBeGreaterThan(0);
      expect(stats.estimatedOutputTokens).toBe(10 * 20); // 10 apiCalls * 20 tokens/call
    });
  });

  describe("Cache errors tracking", () => {
    it("increments cacheErrors on cache get/set throw while keeping check functioning", async () => {
      const faultyCache = {
        async get() {
          throw new Error("Read Cache Failed");
        },
        async set() {
          throw new Error("Write Cache Failed");
        },
      };

      const provider = mockProvider({
        test: { action: "allow", confidence: 0.9 },
      });

      const moderator = createModerator({
        provider,
        policy: defaultPolicy,
        cache: faultyCache,
      });

      const result = await moderator.check({ text: "test" });
      expect(result.action).toBe("allow");

      const stats = moderator.stats();
      expect(stats.cacheErrors).toBe(2); // 1 error from get, 1 error from set
    });
  });

  describe("Retry delay integration", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("delays the second attempt by 300ms", async () => {
      let callCount = 0;
      const transientProvider = {
        name: "transient",
        async moderateBatch() {
          callCount++;
          if (callCount === 1) {
            throw new Error("Transient Error");
          }
          return [{ action: "allow" as ModerationAction, confidence: 0.9 }];
        },
      };

      const moderator = createModerator({
        provider: transientProvider,
        policy: defaultPolicy,
      });

      const checkPromise = moderator.check({ text: "test" });

      await vi.runAllTicks();
      expect(callCount).toBe(1);

      await vi.advanceTimersByTimeAsync(299);
      expect(callCount).toBe(1);

      await vi.advanceTimersByTimeAsync(1);
      const result = await checkPromise;
      expect(result.action).toBe("allow");
      expect(callCount).toBe(2);
    });
  });
});
