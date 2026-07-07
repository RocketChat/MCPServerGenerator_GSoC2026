import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferSamplingResponseSchemas } from "../../composer/validation.js";
import type { ComposeStepInput } from "../../composer/types.js";
import type { SamplingStep } from "../../workflow/types.js";

describe("inferSamplingResponseSchemas", () => {
  it("infers a responseSchema from downstream dot access, guessing types from usage", () => {
    const steps: ComposeStepInput[] = [
      {
        id: "rank",
        label: "Rank",
        config: {
          type: "sampling",
          prompt:
            "Return a JSON object with fields: safe, score and items. {{params.msg}}",
          responseFormat: "json",
        },
      },
      {
        id: "gate",
        label: "Gate",
        config: {
          type: "conditional",
          condition: "steps.rank.safe === true",
          thenStep: "join",
        },
        dependsOn: ["rank"],
      },
      {
        id: "join",
        label: "Join",
        config: {
          type: "transform",
          expression: "steps.rank.items.join(', ') + steps.rank.score",
        },
        dependsOn: ["gate"],
      },
    ];

    const warnings = inferSamplingResponseSchemas(steps);
    const cfg = steps[0].config as SamplingStep;

    assert.deepEqual(cfg.responseSchema, {
      safe: "boolean",
      items: "array",
      score: "string",
    });
    assert.equal(warnings.length, 0);
  });

  it("infers JSON mode from prompt intent even without responseFormat", () => {
    const steps: ComposeStepInput[] = [
      {
        id: "rank",
        label: "Rank",
        config: {
          type: "sampling",
          prompt: "Respond with a JSON object containing a score field.",
        },
      },
      {
        id: "use",
        label: "Use",
        config: { type: "transform", expression: "steps.rank.score" },
        dependsOn: ["rank"],
      },
    ];

    inferSamplingResponseSchemas(steps);
    const cfg = steps[0].config as SamplingStep;
    assert.deepEqual(cfg.responseSchema, { score: "string" });
  });

  it("recognizes bracket-notation field access", () => {
    const steps: ComposeStepInput[] = [
      {
        id: "rank",
        label: "Rank",
        config: {
          type: "sampling",
          prompt: "Return JSON with a safe field.",
          responseFormat: "json",
        },
      },
      {
        id: "use",
        label: "Use",
        config: { type: "transform", expression: 'steps.rank["safe"]' },
        dependsOn: ["rank"],
      },
    ];

    inferSamplingResponseSchemas(steps);
    const cfg = steps[0].config as SamplingStep;
    assert.deepEqual(cfg.responseSchema, { safe: "string" });
  });

  it("warns when a consumed field is not mentioned in the prompt", () => {
    const steps: ComposeStepInput[] = [
      {
        id: "rank",
        label: "Rank",
        config: {
          type: "sampling",
          prompt: "Return a JSON object.",
          responseFormat: "json",
        },
      },
      {
        id: "use",
        label: "Use",
        config: { type: "transform", expression: "steps.rank.score" },
        dependsOn: ["rank"],
      },
    ];

    const warnings = inferSamplingResponseSchemas(steps);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].code, "SAMPLING_SCHEMA_MISMATCH");
    assert.equal(warnings[0].stepId, "rank");
  });

  it("leaves plain-text sampling steps untouched", () => {
    const steps: ComposeStepInput[] = [
      {
        id: "rank",
        label: "Rank",
        config: { type: "sampling", prompt: "Summarize: {{params.msg}}" },
      },
    ];

    const warnings = inferSamplingResponseSchemas(steps);
    const cfg = steps[0].config as SamplingStep;
    assert.equal(cfg.responseSchema, undefined);
    assert.equal(warnings.length, 0);
  });

  it("ignores JS builtin methods when inferring fields", () => {
    const steps: ComposeStepInput[] = [
      {
        id: "rank",
        label: "Rank",
        config: {
          type: "sampling",
          prompt: "Return JSON.",
          responseFormat: "json",
        },
      },
      {
        id: "use",
        label: "Use",
        config: { type: "transform", expression: "steps.rank.length" },
        dependsOn: ["rank"],
      },
    ];

    inferSamplingResponseSchemas(steps);
    const cfg = steps[0].config as SamplingStep;
    assert.equal(cfg.responseSchema, undefined);
  });
});
