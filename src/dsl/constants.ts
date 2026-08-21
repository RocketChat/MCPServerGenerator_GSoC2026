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

export const VALID_RESPONSE_FORMATS = ["text", "json"] as const;

/**
 * Workflow names become filesystem paths (`src/tools/<name>.ts`) and code
 * identifiers in the generated project, so they must be path- and
 * identifier-safe: a leading alphanumeric followed by alphanumerics, dots,
 * hyphens, or underscores. Rejecting anything else blocks path traversal
 * (e.g. `../server`) and silent file clobbering at parse time.
 */
export const WORKFLOW_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** Maximum size of an inline or heredoc SCHEMA payload. */
export const MAX_SCHEMA_SIZE = 100 * 1024;

/**
 * Upper bound for MAX_TOKENS. Guards against typos that would request an
 * unreasonable (or provider-rejected) sampling budget.
 */
export const MAX_TOKENS_LIMIT = 1_000_000;

/**
 * Keywords that only make sense inside specific step types. A keyword used in
 * the wrong step type is rejected at parse time instead of being silently
 * dropped later (e.g. MAP in a `transform` step, which never reads
 * inputMapping). Keywords not listed here (LABEL, DEPENDS ON, OUTPUT_PATH,
 * FOR_EACH, AS, CONTINUE_ON_ERROR) are generic and valid in any step.
 */
export const STEP_KEYWORD_TYPES: Record<string, readonly string[]> = {
  OPERATION: ["api_call"],
  MAP: ["api_call"],
  PROMPT: ["sampling"],
  SYSTEM_PROMPT: ["sampling"],
  MAX_TOKENS: ["sampling"],
  RESPONSE_FORMAT: ["sampling"],
  CONTENT_TEXT: ["sampling"],
  CONTENT_IMAGE: ["sampling"],
  SCHEMA: ["sampling", "elicitation"],
  EXPRESSION: ["transform"],
  CONDITION: ["conditional"],
  THEN: ["conditional"],
  ELSE: ["conditional"],
  MESSAGE: ["elicitation"],
  ON_DECLINE: ["elicitation"],
};
