export const VALID_STEP_TYPES = [
  "api_call",
  "sampling",
  "elicitation",
  "transform",
  "conditional",
] as const;

export const VALID_PARAM_TYPES = [
  "string",
  "number",
  "boolean",
  "object",
  "array",
] as const;

export const VALID_WEBHOOK_METHODS = ["get", "post"] as const;
