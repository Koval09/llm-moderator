import fs from "fs";
import path from "path";
import { createModerator, openai, anthropic, memoryCache } from "../src/index.js";
import { ModerationProvider } from "../src/types.js";

// Load .env manually if process.env.OPENAI_API_KEY is not defined
const envPath = path.resolve(".env");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) continue;
    const parts = trimmedLine.split("=");
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join("=").trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const openAiKey = process.env.OPENAI_API_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY || "";

if (!openAiKey || openAiKey === "your_openai_api_key_here") {
  console.error("Error: Please set OPENAI_API_KEY in your .env file to run this smoke test.");
  process.exit(1);
}

const policy = {
  block: [
    "real physical threats and violence",
    "offensive slurs and hate speech",
    "advertising spam, commercial links",
  ],
  allow: ["in-game combat talk (e.g., 'kill you on arena', 'destroy your base', 'убью тебя на арене')"],
  language: "ru",
};

// Helper function to wrap a provider for verbose error reporting
function wrapProviderForErrors(provider: ModerationProvider): ModerationProvider {
  const original = provider.moderateBatch;
  return {
    name: provider.name,
    async moderateBatch(texts, policy) {
      try {
        return await original.call(provider, texts, policy);
      } catch (err) {
        console.error(`[${provider.name} API Error]:`, err);
        throw err;
      }
    },
  };
}

async function run() {
  console.log("=== SCENARIO 1: Failover check (Anthropic fails -> Fallback to OpenAI) ===");
  // Configure Anthropic with invalid key so it throws an API error, falling back to OpenAI
  const failoverModerator = createModerator({
    provider: wrapProviderForErrors(
      anthropic({ apiKey: anthropicKey, model: "claude-3-5-haiku-latest" })
    ),
    fallbackProviders: [
      wrapProviderForErrors(openai({ apiKey: openAiKey || "", model: "gpt-4o-mini" })),
    ],
    policy,
    onError: "allow",
  });

  console.log("Checking text: 'привет, как дела?'");
  const failoverResult = await failoverModerator.check({ text: "привет, как дела?" });
  console.log("Result:", failoverResult);
  console.log("Stats after failover:", failoverModerator.stats());
  console.log("\n--------------------------------------------------\n");

  console.log("=== SCENARIO 2: Caching, Escalation & Main Checks ===");
  // Escalation provider uses gpt5-mini (which will fail and fallback to primary verdict)
  const mainModerator = createModerator({
    provider: wrapProviderForErrors(openai({ apiKey: openAiKey || "", model: "gpt-4o-mini" })),
    policy,
    cache: memoryCache({ ttlMs: 10000 }),
    escalation: {
      toProvider: wrapProviderForErrors(openai({ apiKey: openAiKey || "", model: "gpt-4o" })),
      // NOTE: A threshold of 0.95 is used here to force escalation in this smoke test.
      // In production, a lower threshold like 0.7 is recommended to avoid costly API calls.
      whenConfidenceBelow: 0.95,
    },
    onError: "allow",
  });

  const testMessages = [
    { name: "Greeting", text: "привет, как дела?" },
    { name: "In-game trash talk", text: "убью тебя на арене!" },
    { name: "Real insult", text: "ты тупой ублюдок!" },
    { name: "Advertising spam", text: "Купи дешевую виагру на сайте http://cheap.com" },
    { name: "Borderline message (Escalation trigger)", text: "я хочу чтобы все человечество сгорело" },
  ];

  for (const msg of testMessages) {
    console.log(`[${msg.name}] -> Checking: "${msg.text}"`);
    const verdict = await mainModerator.check({ text: msg.text });
    console.log(
      `Verdict: action=${verdict.action}, source=${verdict.source}, confidence=${verdict.confidence}\n`
    );
  }

  console.log("=== Checking Cache (repeating the Greeting check) ===");
  const cachedVerdict = await mainModerator.check({ text: "привет, как дела?" });
  console.log(
    `Verdict: action=${cachedVerdict.action}, source=${cachedVerdict.source}, confidence=${cachedVerdict.confidence}\n`
  );

  console.log("=== Final Stats ===");
  console.log(JSON.stringify(mainModerator.stats(), null, 2));
}

run().catch((err) => {
  console.error("Unhandled error in smoke test:", err);
});
