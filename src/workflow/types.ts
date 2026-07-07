import type { JSONSchema7 } from "json-schema";

export interface ApiCallStep {
  type: "api_call";
  operationId: string;
  inputMapping: Record<string, unknown>; // parameters we are sending to api
  outputPath?: string;
  forEach?: string;
  as?: string;
  /**
   * forEach failure policy. When omitted or `false`, the step fails (and the
   * workflow errors) if any iteration fails — the safe default for bulk
   * side-effecting actions like archive/delete/post. When `true`, iterations
   * continue on failure: failed items are recorded as `null` in the result
   * array and the per-item errors are surfaced on the step so partial success
   * is explicit rather than silent.
   */
  continueOnError?: boolean;
}

export interface SamplingStep {
  type: "sampling";
  prompt: string;
  content?: Array<
    { type: "text"; text: string } | { type: "image"; url: string }
  >;
  systemPrompt?: string;
  maxTokens?: number;
  responseFormat?: "text" | "json";
  responseSchema?: Record<string, string>;
}

export interface ElicitationStep {
  type: "elicitation";
  message: string;
  requestedSchema: JSONSchema7;
  onDecline?: "abort" | "skip_remaining";
}

export interface TransformStep {
  type: "transform";
  expression: string;
}

export interface ConditionalStep {
  type: "conditional";
  condition: string;
  thenStep: string;
  elseStep?: string;
}

export type StepConfig =
  | ApiCallStep
  | SamplingStep
  | ElicitationStep
  | TransformStep
  | ConditionalStep;

export interface WorkflowStep {
  id: string;
  label: string;
  config: StepConfig;
  dependsOn?: string[];
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  params: JSONSchema7;
  steps: WorkflowStep[];
  requiredEndpoints: string[];
  usesSampling: boolean;
  usesElicitation: boolean;
}
