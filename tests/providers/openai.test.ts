import { describe, it, expect, vi, beforeEach } from "vitest";
import { openai } from "../../src/providers/openai.js";

const mockOpenAICallbacks = {
  shouldBeMissing: false,
  create: vi.fn(),
  shouldFailApi: false,
};

vi.mock("openai", () => {
  const getMockClass = () => {
    if (mockOpenAICallbacks.shouldBeMissing) {
      return undefined;
    }
    return class {
      chat = {
        completions: {
          create: async (...args: unknown[]) => {
            if (mockOpenAICallbacks.shouldFailApi) {
              throw new Error("Rate limit exceeded");
            }
            return mockOpenAICallbacks.create(...args);
          },
        },
      };
    };
  };

  return {
    get OpenAI() {
      return getMockClass();
    },
    get default() {
      return getMockClass();
    },
  };
});

describe("OpenAI Provider", () => {
  beforeEach(() => {
    mockOpenAICallbacks.shouldBeMissing = false;
    mockOpenAICallbacks.shouldFailApi = false;
    mockOpenAICallbacks.create.mockReset();
  });

  it("throws clear error when SDK is not installed/loaded", async () => {
    mockOpenAICallbacks.shouldBeMissing = true;

    const provider = openai({ apiKey: "test-key" });
    await expect(provider.moderateBatch(["hello"], "policy")).rejects.toThrow(
      "To use the OpenAI provider, you must install the 'openai' package."
    );
  });

  it("sends correct messages and parses response successfully", async () => {
    mockOpenAICallbacks.create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify([{ action: "allow", confidence: 0.95 }]),
          },
        },
      ],
    });

    const provider = openai({ apiKey: "test-key", model: "custom-model" });
    const results = await provider.moderateBatch(["text1"], "my-policy");

    expect(results).toEqual([{ action: "allow", confidence: 0.95 }]);
    expect(mockOpenAICallbacks.create).toHaveBeenCalledWith({
      model: "custom-model",
      messages: [
        { role: "system", content: "my-policy" },
        { role: "user", content: JSON.stringify(["text1"]) },
      ],
      response_format: { type: "json_object" },
    });
  });

  it("handles API/network errors", async () => {
    mockOpenAICallbacks.shouldFailApi = true;

    const provider = openai({ apiKey: "test-key" });
    await expect(provider.moderateBatch(["hello"], "policy")).rejects.toThrow(
      "Rate limit exceeded"
    );
  });
});
