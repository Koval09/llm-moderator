import { ModerationConfig } from "./types.js";

export function compilePolicy(policy: ModerationConfig["policy"]): string {
  const blockSection = policy.block.map((b) => `- ${b}`).join("\n");
  const allowSection =
    policy.allow && policy.allow.length > 0 ? policy.allow.map((a) => `- ${a}`).join("\n") : "None";
  const languageHint = policy.language
    ? `Primary language hint: ${policy.language}`
    : "Detect language automatically.";

  return `You are a strict, high-accuracy content moderation system.
Analyze the input text(s) and classify each according to the moderation policy.

MODERATION POLICY:
Block categories:
${blockSection}

Allow/Exceptions (exceptions to the block rules):
${allowSection}

Language settings:
${languageHint}

OUTPUT FORMAT:
You MUST respond with a strict JSON array of objects. The array must contain exactly the same number of elements as the input texts, in the exact same order.
Do NOT include any conversational filler, markdown formatting (like \`\`\`json ... \`\`\`), or extra text outside the JSON array.

Each object in the array must have the following structure:
{
  "action": "allow" | "flag" | "block",
  "category": string (the specific block category matched, or null/empty if allowed),
  "confidence": number (float between 0.0 and 1.0)
}`;
}
