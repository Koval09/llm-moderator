# llm-moderator

[![npm version](https://img.shields.io/npm/v/llm-moderator.svg)](https://www.npmjs.com/package/llm-moderator)
[![CI](https://github.com/Koval09/llm-moderator/workflows/CI/badge.svg)](https://github.com/Koval09/llm-moderator/actions)

A provider-agnostic, LLM-powered chat moderation toolkit for games and communities. It compiles your custom policies into strict system prompts, handles automatic provider failover, request batching, caching, and smart escalation of borderline messages to high-tier models.

---

## Core Principle

No hardcoded policies or models. You supply the provider, the moderation policy, and all thresholds via config. The library manages the complexity of batching, caching, failover, and structured output parsing.

---

## Installation

Install the core library along with the provider SDK you intend to use. The SDK dependencies are lazy-imported, meaning you only need to install what you use.

```bash
# Core library
npm install llm-moderator

# If using OpenAI
npm install openai

# If using Anthropic
npm install @anthropic-ai/sdk
```

---

## Quick Start

Here is a quick example using the OpenAI provider:

```typescript
import { createModerator, openaiProvider, memoryCache } from "llm-moderator";

const moderator = createModerator({
  provider: openaiProvider({ apiKey: process.env.OPENAI_API_KEY || "", model: "gpt-4o-mini" }),
  policy: {
    block: [
      "real threats of violence and physical harm",
      "offensive slurs and hate speech",
      "commercial spam and ads",
    ],
    allow: [
      "gaming trash talk (e.g. 'kill you on arena', 'destroy your base')",
    ],
    language: "en",
  },
  cache: memoryCache({ ttlMs: 60000 }), // 1 minute cache
});

async function run() {
  const result = await moderator.check({ text: "I will destroy your base!" });
  console.log(result);
  // Output: { action: "allow", confidence: 0.95, source: "primary" }
}

run();
```

---

## Config Reference

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `provider` | `ModerationProvider` | Yes | The primary LLM provider (e.g., `openaiProvider`, `anthropicProvider`, `mockProvider`). |
| `fallbackProviders` | `ModerationProvider[]` | No | Fallback providers tried in order if the primary provider fails. |
| `policy` | `Object` | Yes | Custom moderation guidelines. |
| `policy.block` | `string[]` | Yes | Categories of content to block. |
| `policy.allow` | `string[]` | No | Contextual exceptions to allow (e.g., in-game slang). |
| `policy.language` | `string` | No | Language hint for the model. |
| `batch` | `Object` | No | Enables request batching. |
| `batch.maxSize` | `number` | Yes | Maximum size of a batch. |
| `batch.maxWaitMs` | `number` | Yes | Maximum wait time before flushing a batch. |
| `cache` | `ModerationCache` | No | Built-in or custom cache implementation. |
| `escalation` | `Object` | No | Escalation rules for uncertain checks. |
| `escalation.toProvider` | `ModerationProvider` | Yes | Model to use when confidence is low. |
| `escalation.whenConfidenceBelow` | `number` | Yes | Threshold below which escalation is triggered. |
| `onError` | `"allow" \| "block"` | No | Fail-open (`"allow"`) or fail-closed (`"block"`) policy on errors. Default `"allow"`. |

---

## Example: Game Chat Moderation

In online games, players often use words like "kill" or "destroy" in a non-harmful, playful context. Hardcoded keyword filters block these incorrectly. `llm-moderator` compiles exception rules to handle this:

```typescript
import { createModerator, mockProvider } from "llm-moderator";

const moderator = createModerator({
  provider: mockProvider({
    "i will base-kill you on the next map!": { action: "allow", confidence: 0.98 }
  }),
  policy: {
    block: [
      "real world threats and self-harm encouragement",
      "racial and offensive slurs",
    ],
    allow: [
      "in-game virtual threats, base destruction talk, and virtual killing in-character",
    ],
    language: "en"
  }
});

async function checkChat() {
  const result = await moderator.check({ text: "i will base-kill you on the next map!" });
  console.log(result.action); // "allow"
}
```

---

## Cost-Saving Strategy

To moderate **100k messages/day** in production, running raw high-end LLM requests is prohibitively expensive and slow. `llm-moderator` optimizes this with a layered cost stack:

1. **Normalized Cache**: The moderator normalizes text before caching. Keys are normalized (lowercased, trimmed, punctuation removed, and repeating characters of length 3 or more are collapsed to two, e.g. `"gooood"` collapses to `"good"`, but `"good"` remains distinct from `"god"`). This is a deliberate trade-off to catch spam elongation while avoiding collision on common words.
2. **Batching**: Collects requests for up to `maxWaitMs` and sends them as one request to optimize token overhead.
3. **Escalation**: Uses a cheap model (like `gpt-4o-mini` at $0.15/1M tokens) for 95% of checks, and only escalates to a high-end model (like `gpt-4o` at $5.00/1M tokens) when confidence falls below the threshold.

### Estimated Daily Cost (100k messages/day, 40% cache hit, 5% escalation rate)

| Layer | Requests / Day | Avg Cost | Total Cost / Day |
| --- | --- | --- | --- |
| **Total Checks** | 100,000 | - | - |
| **Cache Hits (40%)** | 40,000 | $0.00 | $0.00 |
| **Primary LLM Calls (`gpt-4o-mini`)** | 60,000 | ~$0.0001 per message | ~$6.00 |
| **Escalations (5% of misses)** | 3,000 | ~$0.0015 per message | ~$4.50 |
| **Total Cost** | | | **~$10.50 / day** |

---

## Recommended Production Setup: Layered Anti-Spam

LLM-based content moderation should be the **last line of defense** because it is the most expensive and slowest layer. A production stack should execute cheap behavioral filters first before calling the LLM:

```
[ User Message ]
       │
       ▼
[ Layer 1: Cooldown Filter ] ──── (Fail) ────► [ Reject (Fast) ]
       │ (Pass)
       ▼
[ Layer 2: Near-Duplicate ]  ──── (Fail) ────► [ Reject (Fast) ]
       │ (Pass)
       ▼
[ Layer 3: memoryCache ]     ──── (Hit)  ────► [ Allow/Block (No LLM Cost) ]
       │ (Miss)
       ▼
[ Layer 4: LLM Moderation ]  ──── (Check) ───► [ Final LLM Verdict ]
```

### Integration Pseudocode

```typescript
import { createModerator, openaiProvider, memoryCache } from "llm-moderator";

const moderator = createModerator({
  provider: openaiProvider({ apiKey: process.env.OPENAI_API_KEY || "" }),
  policy: { block: ["harassment"] }
});

// App-side rate limiting and deduplication
const lastMessageTimestamps = new Map<string, number>();
const lastMessageHashes = new Map<string, string[]>(); // userId -> normalized message hashes

function isSpamming(userId: string, text: string): boolean {
  const now = Date.now();
  
  // Layer 1: Per-user cooldown (1 message every 2s)
  const lastTime = lastMessageTimestamps.get(userId) || 0;
  if (now - lastTime < 2000) return true;
  lastMessageTimestamps.set(userId, now);

  // Layer 2: Near-duplicate detection (Unicode-safe normalization)
  const normalized = text.toLowerCase().trim().replace(/[^\p{L}\p{N}]/gu, "");
  const history = lastMessageHashes.get(userId) || [];
  // NOTE: For simplicity, we use .includes() here. In production, you should calculate
  // the Levenshtein distance <= 2 against history entries to catch near-duplicates (e.g. typos).
  if (history.includes(normalized)) return true;
  
  history.push(normalized);
  if (history.length > 5) history.shift();
  lastMessageHashes.set(userId, history);

  return false;
}

async function handleIncomingMessage(userId: string, text: string) {
  // Layer 1 & 2: Behavioral filters (fast, $0 cost)
  if (isSpamming(userId, text)) {
    return { action: "block", reason: "behavioral-spam" };
  }

  // Layer 3 & 4: Content check (cache lookup, then LLM if miss)
  const verdict = await moderator.check({ text });
  return verdict;
}
```

---

## FAQ

### Which model should I use?
We recommend starting with `gpt-4o-mini` (via `openaiProvider`) or `claude-3-5-haiku-latest` (via `anthropicProvider`) as your primary provider. They are fast, extremely cheap, and yield high accuracy for standard moderation tasks.

### How do I plug in Redis?
You can implement the `ModerationCache` interface to connect Redis. Note that keys are automatically normalized by the moderator before being passed to custom cache methods:

```typescript
import { ModerationCache, Verdict } from "llm-moderator";
import { createClient } from "redis";

const redisClient = createClient();

const redisCache: ModerationCache = {
  async get(key: string): Promise<Verdict | null> {
    // The key parameter is already normalized by the moderator (e.g. lowercased, collapsed)
    const data = await redisClient.get(`mod:${key}`);
    return data ? JSON.parse(data) : null;
  },
  async set(key: string, value: Verdict): Promise<void> {
    // The key parameter is already normalized by the moderator
    await redisClient.setEx(`mod:${key}`, 3600, JSON.stringify(value)); // 1 hour TTL
  }
};
```

### What happens when the API is down?
If the primary provider fails (e.g. rate limit, network down, timeout), the library will automatically attempt the fallback providers configured in `fallbackProviders`. If all fail, it resolves to your `onError` action (default: `"allow"`) with a source of `"error-fallback"`. The `check()` method never throws errors.
