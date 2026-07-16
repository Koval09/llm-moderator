import { describe, it, expect, vi, beforeEach } from "vitest";
import { anthropic } from "../../src/providers/anthropic.js";

const mockAnthropicCallbacks = {
  shouldBeMissing: false,
  create: vi.fn(),
  shouldFailApi: false,
};

vi.mock("@anthropic-ai/sdk", () => {
  const getMockClass = () => {
    if (mockAnthropicCallbacks.shouldBeMissing) {
      return undefined;
    }
    return class {
      messages = {
        create: async (...args: unknown[]) => {
          if (mockAnthropicCallbacks.shouldFailApi) {
            throw new Error("API Error");
          }
          return mockAnthropicCallbacks.create(...args);
        },
      };
    };
  };

  return {
    get Anthropic() {
      return getMockClass();
    },
    get default() {
      return getMockClass();
    },
  };
});

describe("Anthropic Provider", () => {
  beforeEach(() => {
    mockAnthropicCallbacks.shouldBeMissing = false;
    mockAnthropicCallbacks.shouldFailApi = false;
    mockAnthropicCallbacks.create.mockReset();
  });

  it("throws clear error when SDK is not installed/loaded", async () => {
    mockAnthropicCallbacks.shouldBeMissing = true;

    const provider = anthropic({ apiKey: "test-key" });
    await expect(provider.moderateBatch(["hello"], "policy")).rejects.toThrow(
      "To use the Anthropic provider, you must install the '@anthropic-ai/sdk' package."
    );
  });

  it("sends correct messages and parses response successfully", async () => {
    mockAnthropicCallbacks.create.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify([{ action: "block", category: "slurs", confidence: 0.85 }]),
        },
      ],
    });

    const provider = anthropic({ apiKey: "test-key", model: "custom-claude" });
    const results = await provider.moderateBatch(["text1"], "my-policy");

    expect(results).toEqual([{ action: "block", category: "slurs", confidence: 0.85 }]);
    expect(mockAnthropicCallbacks.create).toHaveBeenCalledWith({
      model: "custom-claude",
      max_tokens: 4000,
      system: "my-policy",
      messages: [{ role: "user", content: `Texts to analyze:\n${JSON.stringify(["text1"])}` }],
    });
  });

  it("handles API/network errors", async () => {
    mockAnthropicCallbacks.shouldFailApi = true;

    const provider = anthropic({ apiKey: "test-key" });
    await expect(provider.moderateBatch(["hello"], "policy")).rejects.toThrow("API Error");
  });
});
