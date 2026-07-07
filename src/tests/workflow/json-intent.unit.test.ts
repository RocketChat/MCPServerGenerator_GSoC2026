import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectJsonIntent } from "../../workflow/json-intent.js";

describe("detectJsonIntent", () => {
  it("detects JSON intent from the prompt", () => {
    assert.equal(
      detectJsonIntent({ prompt: "Respond with a JSON object" }),
      true,
    );
  });

  it("detects JSON intent from the systemPrompt", () => {
    assert.equal(
      detectJsonIntent({ systemPrompt: "Output format: json only" }),
      true,
    );
  });

  it("is false for plain-text prompts", () => {
    assert.equal(detectJsonIntent({ prompt: "Summarize this message" }), false);
  });

  it("is false when no prompt fields are provided", () => {
    assert.equal(detectJsonIntent({}), false);
  });
});
