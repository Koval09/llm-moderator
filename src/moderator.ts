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
import { normalizeText } from "./cache.js";

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
    cacheErrors: 0,
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
        onApiCall: (success: boolean, textCount: number, totalTextLength: number) => {
          this.statsStore.apiCalls++;
          this.statsStore.batches++;
          const isFallback = this.config.fallbackProviders?.includes(provider) ?? false;
          if (isFallback) {
            this.statsStore.fallbackProviderCalls++;
          }
          if (!success) {
            this.statsStore.errors++;
          }
          this.statsStore.estimatedInputTokens += Math.ceil(
            (this.compiledPolicy.length + totalTextLength) / 4
          );
          this.statsStore.estimatedOutputTokens += 20 * textCount;
        },
      });
      this.batchers.set(provider, batcher);
    }
    return batcher;
  }

  async check(params: { text: string }): Promise<Verdict> {
    this.statsStore.checked++;
    const normalizedText = normalizeText(params.text);

    if (this.config.cache) {
      try {
        const cached = await this.config.cache.get(normalizedText);
        if (cached) {
          this.statsStore.cacheHits++;
          return {
            ...cached,
            source: "cache",
          };
        }
      } catch {
        this.statsStore.cacheErrors++;
      }
    }

    const providersToTry = [
      { provider: this.config.provider, isPrimary: true },
      ...(this.config.fallbackProviders || []).map((p) => ({ provider: p, isPrimary: false })),
    ];

    for (const item of providersToTry) {
      const { provider, isPrimary } = item;

      // Initial attempt + 1 retry = 2 attempts total
      for (let attempt = 1; attempt <= 2; attempt++) {
        if (attempt > 1) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        try {
          let rawVerdict: RawVerdict;

          if (this.config.batch && attempt === 1) {
            const batcher = this.getBatcher(provider);
            rawVerdict = await batcher.add(params.text);
          } else {
            // Direct call (no batching)
            const isFallback = this.config.fallbackProviders?.includes(provider) ?? false;
            if (isFallback) {
              this.statsStore.fallbackProviderCalls++;
            }
            this.statsStore.apiCalls++;
            this.statsStore.estimatedInputTokens += Math.ceil(
              (this.compiledPolicy.length + params.text.length) / 4
            );
            this.statsStore.estimatedOutputTokens += 20;

            try {
              const results = await provider.moderateBatch([params.text], this.compiledPolicy);
              const parsed = RawVerdictArraySchema.safeParse(results);
              if (!parsed.success || parsed.data.length !== 1) {
                throw new Error("Invalid response or length mismatch");
              }
              rawVerdict = parsed.data[0];
            } catch (err) {
              this.statsStore.errors++;
              throw err;
            }
          }

          let resultVerdict: Verdict = {
            action: rawVerdict.action,
            category: rawVerdict.category,
            confidence: rawVerdict.confidence,
            source: isPrimary ? "primary" : "fallback-provider",
          };

          // Check if escalation is configured and confidence threshold is met
          if (
            isPrimary &&
            this.config.escalation &&
            resultVerdict.confidence < this.config.escalation.whenConfidenceBelow
          ) {
            this.statsStore.escalations++;

            const escProvider = this.config.escalation.toProvider;
            let escRawVerdict: RawVerdict | null = null;

            for (let escAttempt = 1; escAttempt <= 2; escAttempt++) {
              if (escAttempt > 1) {
                await new Promise((resolve) => setTimeout(resolve, 300));
              }
              try {
                if (this.config.batch && escAttempt === 1) {
                  const escBatcher = this.getBatcher(escProvider);
                  escRawVerdict = await escBatcher.add(params.text);
                } else {
                  this.statsStore.apiCalls++;
                  this.statsStore.estimatedInputTokens += Math.ceil(
                    (this.compiledPolicy.length + params.text.length) / 4
                  );
                  this.statsStore.estimatedOutputTokens += 20;

                  try {
                    const results = await escProvider.moderateBatch(
                      [params.text],
                      this.compiledPolicy
                    );
                    const parsed = RawVerdictArraySchema.safeParse(results);
                    if (!parsed.success || parsed.data.length !== 1) {
                      throw new Error("Invalid response or length mismatch");
                    }
                    escRawVerdict = parsed.data[0];
                  } catch (err) {
                    this.statsStore.errors++;
                    throw err;
                  }
                }
                break;
              } catch {
                // Squelch and retry
              }
            }

            if (escRawVerdict) {
              resultVerdict = {
                action: escRawVerdict.action,
                category: escRawVerdict.category,
                confidence: escRawVerdict.confidence,
                source: "escalation",
              };
            }
          }

          if (this.config.cache) {
            try {
              await this.config.cache.set(normalizedText, resultVerdict);
            } catch {
              this.statsStore.cacheErrors++;
            }
          }

          return resultVerdict;
        } catch {
          // If batcher/direct rejected, we catch here and loop to the next attempt (retry)
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
