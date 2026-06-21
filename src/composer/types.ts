import type { JSONSchema7 } from "json-schema";
import type { StepConfig, WorkflowDefinition } from "../workflow/types.js";

export interface ComposeWorkflowInput {
  name: string;
  description: string;
  params: JSONSchema7;
  steps: ComposeStepInput[];
}

export interface ComposeStepInput {
  id: string;
  label: string;
  config: StepConfig;
  dependsOn?: string[];
}

export interface ComposerWarning {
  stepId: string | null;
  code:
    | "UNUSED_SAMPLING"
    | "ORPHANED_STEP"
    | "MULTIPLE_ROOTS"
    | "DUPLICATE_API_CALL"
    | "DEEP_CHAIN"
    | "IMPLICIT_DEP_ADDED"
    | "DATA_FLOW_WARNING"
    | "STATIC_SAMPLING_PROMPT"
    | "HARDCODED_RID"
    | "TEMPLATE_AUTO_WRAPPED"
    | "AS_VAR_REWRITTEN"
    | "REQUEST_BODY_UNWRAPPED"
    | "EVENT_PARAM_REWRITTEN"
    | "PARAM_SUBFIELD_UNKNOWN"
    | "SAMPLING_SCHEMA_MISMATCH"
    | "FIELD_STRIPPED"
    | "FIELD_AUTO_SET"
    | "OUTPUT_PATH_INFERRED"
    | "OUTPUT_PATH_REF_FIXED"
    | "EVENT_PARAM_SHORTHAND"
    | "STRINGIFIED_JSON_PARSED";
  message: string;
}

export interface ComposeWorkflowResult {
  workflow: WorkflowDefinition;
  executionOrder: string[];
  summary: {
    stepCount: number;
    apiCalls: string[];
    usesSampling: boolean;
    usesElicitation: boolean;
    hasConditionals: boolean;
  };
  warnings: ComposerWarning[];
}

export class ComposerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposerError";
  }
}
