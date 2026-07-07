import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateDataFlowTypes } from "../../composer/validation.js";
import type { ComposeStepInput } from "../../composer/types.js";

/**
 * These exercise the guard that closes the "plain-text sampling used like JSON"
 * gap: field access is only valid against an object-shaped result. Sampling is a
 * plain-text string unless it is in JSON mode (explicit responseFormat: "json"
 * or JSON intent in the prompt), in which case the runtime parses it to an object.
 */
describe("validateDataFlowTypes", () => {
  it("rejects field access on a plain-text sampling result", () => {
    const steps: ComposeStepInput[] = [
      {
        id: "analyze",
        label: "Analyze",
        // No responseFormat and no JSON intent -> plain text string.
        config: { type: "sampling", prompt: "Analyze: {{params.msg}}" },
      },
      {
        id: "route",
        label: "Route",
        config: {
          type: "conditional",
          condition: "steps.analyze.toxicityScore > 0.7",
          thenStep: "act",
        },
        dependsOn: ["analyze"],
      },
    ];
    assert.throws(
      () => validateDataFlowTypes(steps),
      /plain text strings with no properties/,
    );
  });

  it("allows field access when the sampling step declares responseFormat: json", () => {
    const steps: ComposeStepInput[] = [
      {
        id: "analyze",
        label: "Analyze",
        config: {
          type: "sampling",
          prompt: "Analyze {{params.msg}} and return a JSON object",
          responseFormat: "json",
        },
      },
      {
        id: "route",
        label: "Route",
        config: {
          type: "conditional",
          condition: "steps.analyze.toxicityScore > 0.7",
          thenStep: "act",
        },
        dependsOn: ["analyze"],
      },
    ];
    assert.doesNotThrow(() => validateDataFlowTypes(steps));
  });

  it("allows field access when the prompt signals JSON intent (no explicit responseFormat)", () => {
    const steps: ComposeStepInput[] = [
      {
        id: "analyze",
        label: "Analyze",
        config: {
          type: "sampling",
          prompt: "Analyze {{params.msg}} and respond with a JSON object",
        },
      },
      {
        id: "route",
        label: "Route",
        config: {
          type: "conditional",
          condition: "steps.analyze.toxicityScore > 0.7",
          thenStep: "act",
        },
        dependsOn: ["analyze"],
      },
    ];
    assert.doesNotThrow(() => validateDataFlowTypes(steps));
  });

  it("allows string method calls on a plain-text sampling result", () => {
    const steps: ComposeStepInput[] = [
      {
        id: "analyze",
        label: "Analyze",
        config: { type: "sampling", prompt: "Check: {{params.msg}}" },
      },
      {
        id: "route",
        label: "Route",
        config: {
          type: "conditional",
          condition: 'steps.analyze.includes("toxic")',
          thenStep: "act",
        },
        dependsOn: ["analyze"],
      },
    ];
    assert.doesNotThrow(() => validateDataFlowTypes(steps));
  });

  it("rejects field access on a conditional (boolean) result", () => {
    const steps: ComposeStepInput[] = [
      {
        id: "check",
        label: "Check",
        config: { type: "conditional", condition: "true", thenStep: "next" },
      },
      {
        id: "next",
        label: "Next",
        config: { type: "transform", expression: "steps.check.someField" },
        dependsOn: ["check"],
      },
    ];
    assert.throws(
      () => validateDataFlowTypes(steps),
      /booleans with no properties/,
    );
  });

  it("allows field access on api_call results", () => {
    const steps: ComposeStepInput[] = [
      {
        id: "fetch",
        label: "Fetch",
        config: {
          type: "api_call",
          operationId: "get-api-v1-channels-list",
          inputMapping: {},
        },
      },
      {
        id: "extract",
        label: "Extract",
        config: { type: "transform", expression: "steps.fetch.channels" },
        dependsOn: ["fetch"],
      },
    ];
    assert.doesNotThrow(() => validateDataFlowTypes(steps));
  });

  it("allows field access on elicitation results", () => {
    const steps: ComposeStepInput[] = [
      {
        id: "ask",
        label: "Ask",
        config: {
          type: "elicitation",
          message: "Confirm?",
          requestedSchema: {
            type: "object",
            properties: { confirm: { type: "boolean" } },
          },
        },
      },
      {
        id: "check",
        label: "Check",
        config: {
          type: "conditional",
          condition: "steps.ask.confirm === true",
          thenStep: "done",
        },
        dependsOn: ["ask"],
      },
    ];
    assert.doesNotThrow(() => validateDataFlowTypes(steps));
  });
});
