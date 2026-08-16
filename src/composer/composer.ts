import type {
  ApiCallStep,
  WorkflowDefinition,
  WorkflowStep,
} from "../workflow/types.js";
import {
  type ComposeWorkflowInput,
  type ComposeWorkflowResult,
  ComposerError,
  type ComposerWarning,
  type ComposeStepInput,
} from "./types.js";
import {
  injectImplicitDependencies,
  inferMissingConditionalTargets,
  inferOutputPath,
  inferSamplingResponseSchemas,
} from "./inference.js";
import {
  flattenNestedSteps,
  normalizeEventParamShorthand,
  normalizeStepFields,
  normalizeTemplateFields,
} from "./normalization.js";
import {
  detectCycles,
  validateDataFlowTypes,
  validateReferences,
  validateSafeWorkflowExpressions,
  validateStepConfig,
  validateTemplateReferences,
  validateUniqueIds,
} from "./validation.js";
import { topologicalSort } from "./utils.js";
import { generateSemanticWarnings } from "./warnings.js";

export {
  ComposerError,
  type ComposerWarning,
  type ComposeStepInput,
  type ComposeWorkflowInput,
  type ComposeWorkflowResult,
};

export function composeWorkflowDefinition(
  input: ComposeWorkflowInput,
): ComposeWorkflowResult {
  const { name, description, params, steps } = input;

  if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new ComposerError(
      `Invalid workflow name "${name}": must be lowercase with underscores (e.g. "onboard_user")`,
    );
  }

  if (!description) {
    throw new ComposerError("Workflow description is required");
  }

  if (steps.length === 0) {
    throw new ComposerError("Workflow must have at least one step");
  }

  const flattenWarnings = flattenNestedSteps(steps);
  validateUniqueIds(steps);
  const fieldNormWarnings = normalizeStepFields(steps);
  const conditionalInferWarnings = inferMissingConditionalTargets(steps);
  for (const step of steps) {
    validateStepConfig(step);
  }

  const eventParamWarnings = normalizeEventParamShorthand(steps, params);
  const normalizationWarnings = normalizeTemplateFields(steps);

  validateReferences(steps);

  const implicitDepWarnings = injectImplicitDependencies(steps);
  const outputPathWarnings = inferOutputPath(steps);

  detectCycles(steps);
  const templateRefWarnings = validateTemplateReferences(steps, params);
  validateDataFlowTypes(steps);
  validateSafeWorkflowExpressions(steps);

  const samplingSchemaWarnings = inferSamplingResponseSchemas(steps);
  const semanticWarnings = generateSemanticWarnings(steps, params);

  const allWarnings = [
    ...flattenWarnings,
    ...fieldNormWarnings,
    ...conditionalInferWarnings,
    ...eventParamWarnings,
    ...normalizationWarnings,
    ...implicitDepWarnings,
    ...outputPathWarnings,
    ...templateRefWarnings,
    ...samplingSchemaWarnings,
    ...semanticWarnings,
  ];

  const executionOrder = topologicalSort(steps);

  const orderedSteps: WorkflowStep[] = executionOrder.map((id) => {
    const step = steps.find((s) => s.id === id)!;
    const ws: WorkflowStep = {
      id: step.id,
      label: step.label,
      config: step.config,
    };
    if (step.dependsOn && step.dependsOn.length > 0) {
      ws.dependsOn = step.dependsOn;
    }
    return ws;
  });

  const usesSampling = steps.some((s) => s.config.type === "sampling");
  const usesElicitation = steps.some((s) => s.config.type === "elicitation");
  const hasConditionals = steps.some((s) => s.config.type === "conditional");

  const requiredEndpoints = steps
    .filter((s) => s.config.type === "api_call")
    .map((s) => (s.config as ApiCallStep).operationId);

  const workflow: WorkflowDefinition = {
    name,
    description,
    params,
    steps: orderedSteps,
    requiredEndpoints,
    usesSampling,
    usesElicitation,
  };

  return {
    workflow,
    executionOrder,
    summary: {
      stepCount: steps.length,
      apiCalls: requiredEndpoints,
      usesSampling,
      usesElicitation,
      hasConditionals,
    },
    warnings: allWarnings,
  };
}
