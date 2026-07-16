import { createModerator, mockProvider, memoryCache } from "../src/index.js";

// Define mock responses for local run without real API keys
const fixtures = {
  "gg well played": { action: "allow", confidence: 0.99 },
  "i will destroy your base, prep to die!": { action: "allow", confidence: 0.95 },
  "you are a complete loser, go die in a hole": {
    action: "block",
    category: "harassment",
    confidence: 0.98,
  },
  "click here to get free gold at http://scam.com": {
    action: "block",
    category: "spam",
    confidence: 0.99,
  },
} as const;

const provider = mockProvider(fixtures);

const moderator = createModerator({
  provider,
  policy: {
    block: [
      "harassment and personal attacks",
      "advertising spam and scam links",
      "real life violence threats",
    ],
    allow: ["in-game combat talk (e.g. base destruction, base defense, virtual arena killing)"],
    language: "en",
  },
  cache: memoryCache({ ttlMs: 60000 }),
});

async function main() {
  console.log("=== Game Chat Moderation Example ===\n");

  const chats = [
    "gg well played",
    "i will destroy your base, prep to die!",
    "you are a complete loser, go die in a hole",
    "click here to get free gold at http://scam.com",
  ];

  for (const text of chats) {
    console.log(`User Chat: "${text}"`);
    const verdict = await moderator.check({ text });
    console.log(
      `Verdict: action=${verdict.action}, source=${verdict.source}, confidence=${
        verdict.confidence
      } ${verdict.category ? `(category: ${verdict.category})` : ""}\n`
    );
  }

  console.log("Final Stats:", moderator.stats());
}

main().catch(console.error);
