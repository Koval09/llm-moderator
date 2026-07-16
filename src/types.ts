export type ModerationAction = "allow" | "flag" | "block";

export type VerdictSource =
  "cache" | "primary" | "escalation" | "fallback-provider" | "error-fallback";

export interface Verdict {
  action: ModerationAction;
  category?: string;
  confidence: number;
  source: VerdictSource;
}

export interface RawVerdict {
  action: ModerationAction;
  category?: string;
  confidence: number;
}

export interface ModerationProvider {
  name: string;
  moderateBatch(texts: string[], compiledPolicy: string): Promise<RawVerdict[]>;
}

export interface ModerationCache {
  get(key: string): Promise<Verdict | null> | Verdict | null;
  set(key: string, value: Verdict): Promise<void> | void;
}

export interface ModerationConfig {
  provider: ModerationProvider;
  fallbackProviders?: ModerationProvider[];
  policy: {
    allow?: string[];
    block: string[];
    language?: string;
  };
  batch?: {
    maxSize: number;
    maxWaitMs: number;
  };
  cache?: ModerationCache;
  escalation?: {
    toProvider: ModerationProvider;
    whenConfidenceBelow: number;
  };
  onError?: "allow" | "block";
}

export interface ModeratorStats {
  checked: number;
  cacheHits: number;
  apiCalls: number;
  batches: number;
  escalations: number;
  fallbackProviderCalls: number;
  errors: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
}

export interface Moderator {
  check(params: { text: string; userId?: string; chatId?: string }): Promise<Verdict>;
  stats(): ModeratorStats;
}
