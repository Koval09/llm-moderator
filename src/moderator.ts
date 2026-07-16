import { Moderator, ModerationConfig, Verdict, ModeratorStats } from "./types.js";
import { compilePolicy } from "./policy.js";
import { z } from "zod";

const RawVerdictSchema = z.object({
  action: z.enum(["allow", "flag", "block"]),
  category: z
    .string()
    .nullish()
    .transform((v) => v ?? undefined),
  confidence: z.number(),
});

const RawVerdictArraySchema = z.array(RawVerdictSchema);

class ModeratorImpl implements Moderator {
  private config: ModerationConfig;
  private compiledPolicy: string;
  private statsStore: ModeratorStats = {
    checked: 0,
    cacheHits: 0,
    apiCalls: 0,
    batches: 0,
    escalations: 0,
    fallbackProviderCalls: 0,
    errors: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
  };

  constructor(config: ModerationConfig) {
    this.config = config;
    this.compiledPolicy = compilePolicy(config.policy);
  }

  async check(params: { text: string; userId?: string; chatId?: string }): Promise<Verdict> {
    this.statsStore.checked++;

    const providersToTry = [
      { provider: this.config.provider, isPrimary: true },
      ...(this.config.fallbackProviders || []).map((p) => ({ provider: p, isPrimary: false })),
    ];

    for (const item of providersToTry) {
      const { provider, isPrimary } = item;

      // Initial attempt + 1 retry = 2 attempts total
      for (let attempt = 1; attempt <= 2; attempt++) {
        if (!isPrimary) {
          this.statsStore.fallbackProviderCalls++;
        }
        this.statsStore.apiCalls++;

        try {
          const results = await provider.moderateBatch([params.text], this.compiledPolicy);

          const parsed = RawVerdictArraySchema.safeParse(results);
          if (!parsed.success) {
            this.statsStore.errors++;
            continue;
          }

          if (parsed.data.length !== 1) {
            this.statsStore.errors++;
            continue;
          }

          const rawVerdict = parsed.data[0];
          return {
            action: rawVerdict.action,
            category: rawVerdict.category,
            confidence: rawVerdict.confidence,
            source: isPrimary ? "primary" : "fallback-provider",
          };
        } catch {
          this.statsStore.errors++;
        }
      }
    }

    const fallbackAction = this.config.onError || "allow";
    return {
      action: fallbackAction,
      confidence: 0,
      source: "error-fallback",
    };
  }

  stats(): ModeratorStats {
    return { ...this.statsStore };
  }
}

export function createModerator(config: ModerationConfig): Moderator {
  return new ModeratorImpl(config);
}
