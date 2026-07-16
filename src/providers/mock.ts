import { ModerationProvider, RawVerdict } from "../types.js";

export interface MockProviderFixtures {
  [text: string]: Partial<RawVerdict> | "error" | "invalid";
}

export function mockProvider(
  fixtures: MockProviderFixtures,
  options?: { name?: string }
): ModerationProvider {
  return {
    name: options?.name || "mock-provider",
    async moderateBatch(texts: string[], _compiledPolicy: string): Promise<RawVerdict[]> {
      const results: RawVerdict[] = [];
      for (const text of texts) {
        const fixture = fixtures[text];
        if (fixture === "error") {
          throw new Error(`Mock provider error for: ${text}`);
        }
        if (fixture === "invalid") {
          results.push({
            action: "invalid-action" as unknown as ModerationAction,
            confidence: -1,
          });
          continue;
        }
        if (fixture) {
          results.push({
            action: fixture.action ?? "allow",
            category: fixture.category,
            confidence: fixture.confidence ?? 1.0,
          });
        } else {
          // Default fallback for unknown text
          results.push({
            action: "allow",
            confidence: 1.0,
          });
        }
      }
      return results;
    },
  };
}
