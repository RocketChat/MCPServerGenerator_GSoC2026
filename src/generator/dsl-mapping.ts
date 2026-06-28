import type { JSONSchema7 } from "json-schema";
import type { DslStep, DslWorkflow } from "../dsl/types.js";
import type { ComposeStepInput, ComposeWorkflowInput } from "../composer/types.js";
import type { StepConfig } from "../workflow/types.js";

/**
 * Bridge the flat DSL step shape produced by the parser into the discriminated
 * `StepConfig` union the composer consumes. This is the seam between the DSL
 * front end and the workflow model.
 */
function stepConfig(step: DslStep): StepConfig {
  switch (step.type) {
    case "api_call":
      return {
        type: "api_call",
        operationId: step.operationId ?? "",
        inputMapping: step.inputMapping ?? {},
        ...(step.outputPath !== undefined ? { outputPath: step.outputPath } : {}),
        ...(step.forEach !== undefined ? { forEach: step.forEach } : {}),
        ...(step.as !== undefined ? { as: step.as } : {}),
      };
    case "sampling":
      return {
        type: "sampling",
        prompt: step.prompt ?? "",
        ...(step.content !== undefined ? { content: step.content } : {}),
        ...(step.systemPrompt !== undefined ? { systemPrompt: step.systemPrompt } : {}),
        ...(step.maxTokens !== undefined ? { maxTokens: step.maxTokens } : {}),
        ...(step.responseFormat !== undefined
          ? { responseFormat: step.responseFormat as "text" | "json" }
          : {}),
      };
    case "elicitation":
      return {
        type: "elicitation",
        message: step.message ?? "",
        requestedSchema: (step.requestedSchema ?? { type: "object" }) as JSONSchema7,
        ...(step.onDecline !== undefined ? { onDecline: step.onDecline } : {}),
      };
    case "transform":
      return { type: "transform", expression: step.expression ?? "" };
    case "conditional":
      return {
        type: "conditional",
        condition: step.condition ?? "",
        thenStep: step.thenStep ?? "",
        ...(step.elseStep !== undefined ? { elseStep: step.elseStep } : {}),
      };
    default:
      throw new Error(`Unknown DSL step type "${step.type}" in step "${step.id}".`);
  }
}

function toStepInput(step: DslStep): ComposeStepInput {
  return {
    id: step.id,
    label: step.label ?? step.id,
    config: stepConfig(step),
    ...(step.dependsOn && step.dependsOn.length > 0 ? { dependsOn: step.dependsOn } : {}),
  };
}

/** Convert a parsed DSL workflow into the composer's input shape. */
export function dslWorkflowToComposeInput(
  workflow: DslWorkflow,
): ComposeWorkflowInput {
  return {
    name: workflow.name,
    description: workflow.description,
    params: (workflow.params ?? { type: "object", properties: {} }) as JSONSchema7,
    steps: workflow.steps.map(toStepInput),
  };
}
