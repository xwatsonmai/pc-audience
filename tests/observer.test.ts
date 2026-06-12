import { describe, expect, it } from "vitest";
import { getConfigIssue } from "../src/main/ai/providers";
import { DEFAULT_SETTINGS } from "../src/shared/defaults";
import { isSensitiveApp } from "../src/shared/privacy";

describe("observer guardrails", () => {
  it("matches sensitive applications before capture", () => {
    expect(isSensitiveApp("1Password 8", ["1Password"])).toBe(true);
    expect(isSensitiveApp("Visual Studio Code", ["1Password"])).toBe(false);
  });

  it("reports missing provider configuration", () => {
    expect(getConfigIssue(DEFAULT_SETTINGS)).toContain("API Key");
    expect(
      getConfigIssue({
        ...DEFAULT_SETTINGS,
        visionProviderMode: "ollama",
        textProviderMode: "ollama",
        ollamaVisionModel: "llava",
        ollamaTextModel: "qwen2.5",
      }),
    ).toBeNull();
  });

  it("supports separate vision and text providers", () => {
    expect(
      getConfigIssue({
        ...DEFAULT_SETTINGS,
        visionProviderMode: "openai",
        textProviderMode: "ollama",
        openAiBaseUrl: "https://example.com/v1",
        openAiApiKey: "test-key",
        openAiVisionModel: "vision-model",
        ollamaBaseUrl: "http://localhost:11434",
        ollamaTextModel: "qwen3.5:2b",
      }),
    ).toBeNull();
  });
});
