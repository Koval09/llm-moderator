import {
  Moderator,
  ModerationConfig,
  Verdict,
  ModeratorStats,
  RawVerdict,
  RawVerdictArraySchema,
  ModerationProvider,
} from "./types.js";
import { compilePolicy } from "./policy.js";
import { Batcher } from "./batcher.js";

class ModeratorImpl implements Moderator {
  private config: ModerationConfig;
  private compiledPolicy: string;
  private batchers = new Map<ModerationProvider, Batcher>();
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

  private getBatcher(provider: ModerationProvider): Batcher {
    let batcher = this.batchers.get(provider);
    if (!batcher) {
      batcher = new Batcher({
        provider,
        maxSize: this.config.batch!.maxSize,
        maxWaitMs: this.config.batch!.maxWaitMs,
        compiledPolicy: this.compiledPolicy,
        onApiCall: (success: boolean) => {
          this.statsStore.apiCalls++;
          this.statsStore.batches++;
          if (provider !== this.config.provider) {
            this.statsStore.fallbackProviderCalls++;
          }
          if (!success) {
            this.statsStore.errors++;
          }
        },
      });
      this.batchers.set(provider, batcher);
    }
    return batcher;
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
        try {
          let rawVerdict: RawVerdict;

          if (this.config.batch) {
            const batcher = this.getBatcher(provider);
            rawVerdict = await batcher.add(params.text);
          } else {
            // Direct call (no batching)
            if (!isPrimary) {
              this.statsStore.fallbackProviderCalls++;
            }
            this.statsStore.apiCalls++;

            try {
              const results = await provider.moderateBatch([params.text], this.compiledPolicy);
              const parsed = RawVerdictArraySchema.safeParse(results);
              if (!parsed.success || parsed.data.length !== 1) {
                this.statsStore.errors++;
                continue;
              }
              rawVerdict = parsed.data[0];
            } catch {
              this.statsStore.errors++;
              continue;
            }
          }

          return {
            action: rawVerdict.action,
            category: rawVerdict.category,
            confidence: rawVerdict.confidence,
            source: isPrimary ? "primary" : "fallback-provider",
          };
        } catch {
          // If batcher rejected, we catch here and loop to the next attempt (retry)
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
