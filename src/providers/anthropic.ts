import { ModerationProvider, RawVerdict } from "../types.js";

function parseJSONResponse(text: string): RawVerdict[] {
  let clean = text.trim();
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```[a-zA-Z]*\n/, "").replace(/\n```$/, "");
  }
  return JSON.parse(clean.trim()) as RawVerdict[];
}

export function anthropicProvider(options: {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}): ModerationProvider {
  const modelName = options.model || "claude-3-5-haiku-latest";
  const timeoutMs = options.timeoutMs ?? 10000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cachedClient: any = null;

  return {
    name: "anthropic",
    async moderateBatch(texts: string[], compiledPolicy: string): Promise<RawVerdict[]> {
      if (!cachedClient) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let AnthropicClass: new (opts: { apiKey: string }) => any;
        try {
          const sdk = await import("@anthropic-ai/sdk");
          const resolved = sdk.default || sdk.Anthropic;
          if (resolved) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            AnthropicClass = resolved as any;
          } else if ("Anthropic" in sdk) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            AnthropicClass = (sdk as Record<string, any>).Anthropic;
          } else {
            throw new Error();
          }
        } catch {
          throw new Error(
            "To use the Anthropic provider, you must install the '@anthropic-ai/sdk' package."
          );
        }

        if (!AnthropicClass) {
          throw new Error(
            "To use the Anthropic provider, you must install the '@anthropic-ai/sdk' package."
          );
        }

        cachedClient = new AnthropicClass({ apiKey: options.apiKey });
      }

      const response = await cachedClient.messages.create(
        {
          model: modelName,
          max_tokens: 4000,
          system: compiledPolicy,
          messages: [
            {
              role: "user",
              content: `Texts to analyze:\n${JSON.stringify(texts)}`,
            },
          ],
        },
        {
          timeout: timeoutMs,
        }
      );

      const responseText = (response.content as Array<{ type: string; text: string }>)
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");

      return parseJSONResponse(responseText);
    },
  };
}
