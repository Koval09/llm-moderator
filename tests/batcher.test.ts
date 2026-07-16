import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createModerator } from "../src/moderator.js";
import { mockProvider } from "../src/providers/mock.js";
import { Batcher } from "../src/batcher.js";

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

    // Let the batch call fail and bypass the 300ms retry delay
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(300);

    const [result1, result2] = await Promise.all([promise1, promise2]);

    expect(result1.action).toBe("allow");
    expect(result1.source).toBe("fallback-provider");
    expect(result2.action).toBe("block");
    expect(result2.source).toBe("fallback-provider");

    const stats = moderator.stats();
    expect(stats.errors).toBe(3); // 1 primary batch failed + 2 primary direct retries failed
    expect(stats.apiCalls).toBe(4); // 1 primary batch + 2 primary direct + 1 fallback batch
    expect(stats.batches).toBe(2); // 1 primary batch + 1 fallback batch
  });

  it("concurrent batch flushes do not mix or contaminate", async () => {
    const provider = mockProvider({
      a1: { action: "allow", confidence: 0.9 },
      a2: { action: "block", confidence: 0.9 },
      b1: { action: "allow", confidence: 0.8 },
      b2: { action: "block", confidence: 0.8 },
    });

    const moderator = createModerator({
      provider,
      policy: { block: [] },
      batch: { maxSize: 2, maxWaitMs: 100 },
    });

    const p_a1 = moderator.check({ text: "a1" });
    const p_a2 = moderator.check({ text: "a2" });

    const p_b1 = moderator.check({ text: "b1" });
    const p_b2 = moderator.check({ text: "b2" });

    const [res_a1, res_a2, res_b1, res_b2] = await Promise.all([p_a1, p_a2, p_b1, p_b2]);

    expect(res_a1.confidence).toBe(0.9);
    expect(res_a2.confidence).toBe(0.9);
    expect(res_b1.confidence).toBe(0.8);
    expect(res_b2.confidence).toBe(0.8);
  });

  it("safely handles flush errors without causing unhandled promise rejections", async () => {
    const provider = mockProvider({
      fail: "error",
    });

    const batcher = new Batcher({
      provider,
      maxSize: 1,
      maxWaitMs: 100,
      compiledPolicy: "policy",
      onApiCall: () => {
        throw new Error("Callback Error");
      },
    });

    await expect(batcher.add("fail")).rejects.toThrow();
  });
});
