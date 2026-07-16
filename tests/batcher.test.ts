import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createModerator } from "../src/moderator.js";
import { mockProvider } from "../src/providers/mock.js";

describe("Batcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes and moderates when maxSize is reached", async () => {
    let apiCalls = 0;
    const provider = mockProvider({
      text1: { action: "allow", confidence: 0.9 },
      text2: { action: "block", confidence: 0.95 },
    });

    const originalModerateBatch = provider.moderateBatch;
    provider.moderateBatch = async (texts, policy) => {
      apiCalls++;
      return originalModerateBatch(texts, policy);
    };

    const moderator = createModerator({
      provider,
      policy: { block: ["toxic"] },
      batch: { maxSize: 2, maxWaitMs: 100 },
    });

    const promise1 = moderator.check({ text: "text1" });
    const promise2 = moderator.check({ text: "text2" });

    // Since maxSize is 2, the batch should flush immediately
    const [result1, result2] = await Promise.all([promise1, promise2]);

    expect(result1.action).toBe("allow");
    expect(result2.action).toBe("block");
    expect(apiCalls).toBe(1);

    const stats = moderator.stats();
    expect(stats.apiCalls).toBe(1);
    expect(stats.batches).toBe(1);
    expect(stats.checked).toBe(2);
  });

  it("flushes and moderates when maxWaitMs timer expires", async () => {
    let apiCalls = 0;
    const provider = mockProvider({
      text1: { action: "allow", confidence: 0.9 },
    });

    const originalModerateBatch = provider.moderateBatch;
    provider.moderateBatch = async (texts, policy) => {
      apiCalls++;
      return originalModerateBatch(texts, policy);
    };

    const moderator = createModerator({
      provider,
      policy: { block: ["toxic"] },
      batch: { maxSize: 5, maxWaitMs: 100 },
    });

    const checkPromise = moderator.check({ text: "text1" });

    // It should not be called yet because maxSize is 5 and only 1 text is queued
    expect(apiCalls).toBe(0);

    // Fast-forward time
    vi.advanceTimersByTime(100);

    const result = await checkPromise;
    expect(result.action).toBe("allow");
    expect(apiCalls).toBe(1);
  });

  it("sends only one API call for a full batch", async () => {
    let apiCalls = 0;
    const provider = mockProvider({
      t1: { action: "allow", confidence: 0.9 },
      t2: { action: "allow", confidence: 0.9 },
      t3: { action: "allow", confidence: 0.9 },
    });

    const originalModerateBatch = provider.moderateBatch;
    provider.moderateBatch = async (texts, policy) => {
      apiCalls++;
      return originalModerateBatch(texts, policy);
    };

    const moderator = createModerator({
      provider,
      policy: { block: [] },
      batch: { maxSize: 3, maxWaitMs: 200 },
    });

    const p1 = moderator.check({ text: "t1" });
    const p2 = moderator.check({ text: "t2" });
    const p3 = moderator.check({ text: "t3" });

    await Promise.all([p1, p2, p3]);
    expect(apiCalls).toBe(1);
  });

  it("handles batch error without crashing promises (falls back correctly)", async () => {
    const primary = mockProvider({
      t1: "error",
      t2: "error",
    });

    const fallback = mockProvider({
      t1: { action: "allow", confidence: 0.8 },
      t2: { action: "block", confidence: 0.85 },
    });

    const moderator = createModerator({
      provider: primary,
      fallbackProviders: [fallback],
      policy: { block: [] },
      batch: { maxSize: 2, maxWaitMs: 100 },
    });

    const promise1 = moderator.check({ text: "t1" });
    const promise2 = moderator.check({ text: "t2" });

    const [result1, result2] = await Promise.all([promise1, promise2]);

    expect(result1.action).toBe("allow");
    expect(result1.source).toBe("fallback-provider");
    expect(result2.action).toBe("block");
    expect(result2.source).toBe("fallback-provider");

    const stats = moderator.stats();
    expect(stats.errors).toBe(2); // primary failed twice (initial + retry)
    expect(stats.apiCalls).toBe(3); // 2 primary batch calls (initial + retry) + 1 fallback batch call
    expect(stats.batches).toBe(3);
  });
});
