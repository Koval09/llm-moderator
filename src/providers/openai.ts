import { ModerationProvider, RawVerdict } from "../types.js";

function parseJSONResponse(text: string): RawVerdict[] {
  let clean = text.trim();
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```[a-zA-Z]*\n/, "").replace(/\n```$/, "");
  }
  return JSON.parse(clean.trim()) as RawVerdict[];
}

export function openaiProvider(options: {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}): ModerationProvider {
  const modelName = options.model || "gpt-4o-mini";
  const timeoutMs = options.timeoutMs ?? 10000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cachedClient: any = null;

  return {
    name: "openai",
    async moderateBatch(texts: string[], compiledPolicy: string): Promise<RawVerdict[]> {
      if (!cachedClient) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let OpenAIClass: new (opts: { apiKey: string }) => any;
        try {
          const sdk = await import("openai");
          const resolved = sdk.default || sdk.OpenAI;
          if (resolved) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            OpenAIClass = resolved as any;
          } else if ("OpenAI" in sdk) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            OpenAIClass = (sdk as Record<string, any>).OpenAI;
          } else {
            throw new Error();
          }
        } catch {
          throw new Error("To use the OpenAI provider, you must install the 'openai' package.");
        }

        if (!OpenAIClass) {
          throw new Error("To use the OpenAI provider, you must install the 'openai' package.");
        }

        cachedClient = new OpenAIClass({ apiKey: options.apiKey });
      }

      const response = await cachedClient.chat.completions.create(
        {
          model: modelName,
          messages: [
            {
              role: "system",
              content: compiledPolicy,
            },
            {
              role: "user",
              content: JSON.stringify(texts),
            },
          ],
        },
        {
          timeout: timeoutMs,
        }
      );

      const responseText = response.choices[0]?.message?.content || "";
      return parseJSONResponse(responseText);
    },
  };
}
