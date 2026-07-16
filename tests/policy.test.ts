import { describe, it, expect } from "vitest";
import { compilePolicy } from "../src/policy.js";

describe("compilePolicy", () => {
  it("compiles standard policy config", () => {
    const policy = {
      block: ["slurs", "threats"],
      allow: ["gaming combat jargon"],
      language: "en",
    };

    const prompt = compilePolicy(policy);
    expect(prompt).toContain("slurs");
    expect(prompt).toContain("threats");
    expect(prompt).toContain("gaming combat jargon");
    expect(prompt).toContain("Primary language hint: en");
    expect(prompt).toContain("JSON array");
  });

  it("handles missing allow and language", () => {
    const policy = {
      block: ["spam"],
    };

    const prompt = compilePolicy(policy);
    expect(prompt).toContain("spam");
    expect(prompt).toContain("None");
    expect(prompt).toContain("Detect language automatically");
  });
});
