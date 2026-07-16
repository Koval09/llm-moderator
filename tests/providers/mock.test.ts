import { describe, it, expect } from "vitest";
import { mockProvider } from "../../src/providers/mock.js";

describe("mockProvider", () => {
  it("returns configured fixtures", async () => {
    const provider = mockProvider({
      hello: { action: "allow", confidence: 0.99 },
      badword: { action: "block", category: "slurs", confidence: 0.95 },
    });

    const results = await provider.moderateBatch(["hello", "badword"], "dummy_policy");
    expect(results).toEqual([
      { action: "allow", confidence: 0.99 },
      { action: "block", category: "slurs", confidence: 0.95 },
    ]);
  });

  it("returns default allow for unknown text", async () => {
    const provider = mockProvider({});
    const results = await provider.moderateBatch(["unknown"], "dummy_policy");
    expect(results).toEqual([{ action: "allow", confidence: 1.0 }]);
  });

  it("throws error for error-trigger text", async () => {
    const provider = mockProvider({
      broken: "error",
    });
    await expect(provider.moderateBatch(["broken"], "dummy_policy")).rejects.toThrow(
      "Mock provider error for: broken"
    );
  });

  it("returns invalid structure for invalid-trigger text", async () => {
    const provider = mockProvider({
      "invalid-msg": "invalid",
    });
    const results = await provider.moderateBatch(["invalid-msg"], "dummy_policy");
    expect(results).toEqual([{ action: "invalid-action", confidence: -1 }]);
  });
});
