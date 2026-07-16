import { describe, it, expect, vi, beforeEach } from "vitest";
import { anthropicProvider } from "../../src/providers/anthropic.js";

const mockAnthropicCallbacks = {
  shouldBeMissing: false,
  create: vi.fn(),
  shouldFailApi: false,
  constructorCalls: 0,
};

vi.mock("@anthropic-ai/sdk", () => {
  const getMockClass = () => {
    if (mockAnthropicCallbacks.shouldBeMissing) {
      return undefined;
    }
    return class {
      constructor() {
        mockAnthropicCallbacks.constructorCalls++;
      }
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
    mockAnthropicCallbacks.constructorCalls = 0;
    mockAnthropicCallbacks.create.mockReset();
  });

  it("throws clear error when SDK is not installed/loaded", async () => {
    mockAnthropicCallbacks.shouldBeMissing = true;

    const provider = anthropicProvider({ apiKey: "test-key" });
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

    const provider = anthropicProvider({ apiKey: "test-key", model: "custom-claude" });
    const results = await provider.moderateBatch(["text1"], "my-policy");

    expect(results).toEqual([{ action: "block", category: "slurs", confidence: 0.85 }]);
    expect(mockAnthropicCallbacks.create).toHaveBeenCalledWith(
      {
        model: "custom-claude",
        max_tokens: 4000,
        system: "my-policy",
        messages: [{ role: "user", content: `Texts to analyze:\n${JSON.stringify(["text1"])}` }],
      },
      {
        timeout: 10000,
      }
    );
  });

  it("sends correct timeoutMs option", async () => {
    mockAnthropicCallbacks.create.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify([{ action: "block", category: "slurs", confidence: 0.85 }]),
        },
      ],
    });

    const provider = anthropicProvider({ apiKey: "test-key", timeoutMs: 6000 });
    await provider.moderateBatch(["text1"], "my-policy");

    expect(mockAnthropicCallbacks.create).toHaveBeenCalledWith(
      expect.any(Object),
      {
        timeout: 6000,
      }
    );
  });

  it("lazily instantiates client only once", async () => {
    mockAnthropicCallbacks.create.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify([{ action: "block", category: "slurs", confidence: 0.85 }]),
        },
      ],
    });

    const provider = anthropicProvider({ apiKey: "test-key" });
    expect(mockAnthropicCallbacks.constructorCalls).toBe(0);

    await provider.moderateBatch(["text1"], "my-policy");
    expect(mockAnthropicCallbacks.constructorCalls).toBe(1);

    await provider.moderateBatch(["text2"], "my-policy");
    expect(mockAnthropicCallbacks.constructorCalls).toBe(1); // Still 1!
  });

  it("handles API/network errors", async () => {
    mockAnthropicCallbacks.shouldFailApi = true;

    const provider = anthropicProvider({ apiKey: "test-key" });
    await expect(provider.moderateBatch(["hello"], "policy")).rejects.toThrow("API Error");
  });
});
