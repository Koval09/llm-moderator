import { describe, it, expect } from "vitest";
import { createModerator } from "../src/moderator.js";
import { mockProvider } from "../src/providers/mock.js";
import { ModerationProvider, ModerationAction } from "../src/types.js";

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
  });

  it("retries once after invalid JSON/malformed response and succeeds on second try", async () => {
    let callCount = 0;
    const transientProvider: ModerationProvider = {
      name: "transient-provider",
      async moderateBatch(_texts, _compiledPolicy) {
        callCount++;
        if (callCount === 1) {
          // return invalid response
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
    expect(stats.apiCalls).toBe(2); // 1 initial + 1 retry
    expect(stats.errors).toBe(1); // 1 error from the first transient failure
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
    expect(stats.apiCalls).toBe(3); // 2 primary calls (initial + retry) + 1 fallback call
    expect(stats.fallbackProviderCalls).toBe(1);
    expect(stats.errors).toBe(2); // 2 primary errors
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
    // primary (2) + fallback1 (2) + fallback2 (1) = 5 apiCalls
    expect(stats.apiCalls).toBe(5);
    // fallback1 (2) + fallback2 (1) = 3 fallbackProviderCalls
    expect(stats.fallbackProviderCalls).toBe(3);
    // primary errors (2) + fallback1 errors (2) = 4 errors
    expect(stats.errors).toBe(4);
  });

  it("triggers onError fallback after all providers fail (fail-open vs fail-closed)", async () => {
    const primary = mockProvider({ hello: "error" });
    const fallback = mockProvider({ hello: "error" });

    // fail-open test (default)
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

    // fail-closed test
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
    expect(stats.errors).toBe(4); // primary (2) + fallback (2)
  });
});
