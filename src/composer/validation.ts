import type { JSONSchema7 } from "json-schema";
import type {
  ConditionalStep,
  SamplingStep,
  StepConfig,
  TransformStep,
} from "../workflow/types.js";
import {
  ComposerError,
  type ComposerWarning,
  type ComposeStepInput,
} from "./types.js";
import {
  BARE_PARAM_REF_RE,
  JS_BUILTIN_METHODS,
  PARAM_REF_RE,
  STEP_FIELD_ACCESS_RE,
  STEP_REF_RE,
  extractTemplateStrings,
} from "./utils.js";
import {
  autoReturnExpression,
  validateSafeExpression,
} from "../workflow/expression-security.js";
import { detectJsonIntent } from "../workflow/json-intent.js";

export function validateUniqueIds(steps: ComposeStepInput[]): void {
  const ids = new Set<string>();
  for (const step of steps) {
    if (ids.has(step.id)) {
      throw new ComposerError(`Duplicate step ID: "${step.id}"`);
    }
    ids.add(step.id);
  }
}

export function validateReferences(steps: ComposeStepInput[]): void {
  const ids = new Set(steps.map((s) => s.id));

  for (const step of steps) {
    if (step.dependsOn) {
      for (const dep of step.dependsOn) {
        if (!ids.has(dep)) {
          throw new ComposerError(
            `Step "${step.id}" depends on unknown step "${dep}"`,
          );
        }
        if (dep === step.id) {
          throw new ComposerError(`Step "${step.id}" cannot depend on itself`);
        }
      }
    }

    if (step.config.type === "conditional") {
      const cfg = step.config as ConditionalStep;
      if (!ids.has(cfg.thenStep)) {
        throw new ComposerError(
          `Step "${step.id}" references unknown thenStep "${cfg.thenStep}"`,
        );
      }
      if (cfg.elseStep && !ids.has(cfg.elseStep)) {
        throw new ComposerError(
          `Step "${step.id}" references unknown elseStep "${cfg.elseStep}"`,
        );
      }
    }
  }
}

export function detectCycles(steps: ComposeStepInput[]): void {
  const adj = new Map<string, string[]>();
  for (const step of steps) {
    adj.set(step.id, step.dependsOn ?? []);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      const cycle = path.slice(cycleStart).concat(node);
      throw new ComposerError(
        `Circular dependency detected: ${cycle.join(" → ")}`,
      );
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);

    for (const dep of adj.get(node) ?? []) {
      dfs(dep, [...path, node]);
    }

    inStack.delete(node);
  }

  for (const step of steps) {
    if (!visited.has(step.id)) {
      dfs(step.id, []);
    }
  }
}

export function validateStepConfig(step: ComposeStepInput): void {
  const cfg = step.config;
  switch (cfg.type) {
    case "api_call":
      if (!cfg.operationId) {
        throw new ComposerError(
          `Step "${step.id}" (api_call): operationId is required`,
        );
      }
      break;
    case "sampling":
      if (!cfg.prompt) {
        throw new ComposerError(
          `Step "${step.id}" (sampling): prompt is required`,
        );
      }
      if (cfg.content) {
        for (const item of cfg.content) {
          if (item.type === "text" && !item.text) {
            throw new ComposerError(
              `Step "${step.id}" (sampling): content text item requires a text field`,
            );
          }
          if (item.type === "image" && !item.url) {
            throw new ComposerError(
              `Step "${step.id}" (sampling): content image item requires a url field`,
            );
          }
        }
      }
      break;
    case "elicitation":
      if (!cfg.message) {
        throw new ComposerError(
          `Step "${step.id}" (elicitation): message is required`,
        );
      }
      if (!cfg.requestedSchema) {
        throw new ComposerError(
          `Step "${step.id}" (elicitation): requestedSchema is required`,
        );
      }
      break;
    case "transform":
      if (!cfg.expression) {
        throw new ComposerError(
          `Step "${step.id}" (transform): expression is required`,
        );
      }
      break;
    case "conditional":
      if (!cfg.condition) {
        throw new ComposerError(
          `Step "${step.id}" (conditional): condition is required`,
        );
      }
      if (!cfg.thenStep) {
        throw new ComposerError(
          `Step "${step.id}" (conditional): thenStep is required`,
        );
      }
      break;
    default:
      throw new ComposerError(
        `Step "${step.id}": unknown step type "${(cfg as { type: string }).type}"`,
      );
  }
}

function findDomainKeyHint(field: string, params: JSONSchema7): string | null {
  const props = params.properties as
    | Record<string, JSONSchema7 | boolean>
    | undefined;
  if (!props) return null;
  for (const [key, schema] of Object.entries(props)) {
    if (typeof schema === "boolean") continue;
    const subProps = schema.properties as Record<string, unknown> | undefined;
    if (subProps && (field in subProps || `${field}?` in subProps)) {
      return key;
    }
  }
  return null;
}

export function validateTemplateReferences(
  steps: ComposeStepInput[],
  params: JSONSchema7,
): ComposerWarning[] {
  const warnings: ComposerWarning[] = [];
  const stepIds = new Set(steps.map((s) => s.id));
  for (const step of steps) {
    if (step.config.type === "api_call" && step.config.as) {
      stepIds.add(step.config.as);
    }
  }
  const paramProps = new Set(
    params.properties ? Object.keys(params.properties) : [],
  );

  for (const step of steps) {
    const templates = extractTemplateStrings(step.config);
    for (const tmpl of templates) {
      for (const match of tmpl.matchAll(STEP_REF_RE)) {
        const refId = match[1];
        if (!stepIds.has(refId)) {
          throw new ComposerError(
            `Step "${step.id}" references unknown step "${refId}" in template: "${tmpl.slice(0, 80)}"`,
          );
        }
      }
      if (paramProps.size > 0) {
        for (const match of tmpl.matchAll(PARAM_REF_RE)) {
          const fullPath = match[1];
          const segments = fullPath.split(".");
          const topField = segments[0];
          if (!paramProps.has(topField)) {
            const hint = findDomainKeyHint(topField, params);
            throw new ComposerError(
              `Step "${step.id}" references "params.${topField}" but "${topField}" is not in the workflow params schema. Available: ${[...paramProps].join(", ") || "(none)"}` +
                (hint
                  ? `. Did you mean "params.${hint}.${topField}"? Event params are nested under the domain key.`
                  : ""),
            );
          }
          if (segments.length > 1) {
            const subWarning = validateParamSubField(
              segments,
              params,
              step.id,
              fullPath,
            );
            if (subWarning) warnings.push(subWarning);
          }
        }
        const isJsContext =
          step.config.type === "transform" ||
          step.config.type === "conditional";
        if (isJsContext) {
          for (const match of tmpl.matchAll(BARE_PARAM_REF_RE)) {
            const fullPath = match[1];
            const segments = fullPath.split(".");
            const topField = segments[0];
            if (!paramProps.has(topField)) {
              const hint = findDomainKeyHint(topField, params);
              throw new ComposerError(
                `Step "${step.id}" references "params.${topField}" but "${topField}" is not in the workflow params schema. Available: ${[...paramProps].join(", ") || "(none)"}` +
                  (hint
                    ? `. Did you mean "params.${hint}.${topField}"? Event params are nested under the domain key.`
                    : ""),
              );
            }
            if (segments.length > 1) {
              const subWarning = validateParamSubField(
                segments,
                params,
                step.id,
                fullPath,
              );
              if (subWarning) warnings.push(subWarning);
            }
          }
        }
      }
    }
  }
  return warnings;
}

function validateParamSubField(
  segments: string[],
  schema: JSONSchema7,
  stepId: string,
  fullPath: string,
): ComposerWarning | null {
  let current: JSONSchema7 | boolean | undefined = schema;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!current || typeof current === "boolean") return null;
    const props: Record<string, JSONSchema7 | boolean> | undefined = (
      current as JSONSchema7
    ).properties as Record<string, JSONSchema7 | boolean> | undefined;
    if (!props) return null; // No properties defined — can't validate further
    if (!(seg in props)) {
      // Segment not found in this object's properties
      const available = Object.keys(props);
      const parentPath =
        i === 0 ? "params" : `params.${segments.slice(0, i).join(".")}`;
      throw new ComposerError(
        `Step "${stepId}" references "params.${fullPath}" but "${seg}" is not a known property of ${parentPath}. Available: ${available.join(", ")}`,
      );
    }
    const next: JSONSchema7 | boolean = props[seg];
    if (typeof next === "boolean") return null;
    // If this is a leaf type, everything after is JS — allow
    if (i < segments.length - 1 && next.type !== "object" && !next.properties) {
      return null;
    }
    current = next;
  }
  return null;
}

type StepOutputType = "string" | "boolean" | "object" | "unknown";

const STEP_OUTPUT_TYPES: Record<StepConfig["type"], StepOutputType> = {
  sampling: "unknown", // resolved per-step from JSON mode (see resolveStepOutputType)
  conditional: "boolean",
  api_call: "object",
  elicitation: "object",
  transform: "unknown",
};

/**
 * True when a sampling step is meant to yield structured JSON — either because it
 * explicitly declares `responseFormat: "json"` or because its prompt/systemPrompt
 * signal JSON intent. This mirrors the runtime decision (the sampling executor
 * JSON-parses the model output under the same condition), so compose-time
 * validation and execution agree on whether field access is meaningful.
 */
function isJsonModeSampling(cfg: SamplingStep): boolean {
  return cfg.responseFormat === "json" || detectJsonIntent(cfg);
}

/**
 * Resolve a step's effective output type. Sampling is special: its result is a
 * plain text string unless the step is in JSON mode, in which case the runtime
 * parses it into an object. Field access is only valid against the object form,
 * so a plain-text sampling result reports "string" and is rejected by the
 * data-flow guard below.
 */
function resolveStepOutputType(config: StepConfig): StepOutputType {
  if (config.type === "sampling") {
    return isJsonModeSampling(config) ? "object" : "string";
  }
  return STEP_OUTPUT_TYPES[config.type];
}

export function validateDataFlowTypes(steps: ComposeStepInput[]): void {
  const stepById = new Map(steps.map((s) => [s.id, s]));

  for (const step of steps) {
    const templates = extractTemplateStrings(step.config);
    for (const tmpl of templates) {
      for (const match of tmpl.matchAll(STEP_FIELD_ACCESS_RE)) {
        const refStepId = match[1];
        const field = match[2];
        if (JS_BUILTIN_METHODS.has(field)) continue;
        const refStep = stepById.get(refStepId);
        if (!refStep) continue;

        const outputType = resolveStepOutputType(refStep.config);
        if (outputType === "string") {
          throw new ComposerError(
            `Step "${step.id}" accesses ".${field}" on step "${refStepId}" (${refStep.config.type}), ` +
              `but ${refStep.config.type} results are plain text strings with no properties. ` +
              `Fix: (1) Add a systemPrompt to step "${refStepId}" asking the LLM to respond in JSON only, ` +
              `(2) Add a transform step after "${refStepId}" with expression 'JSON.parse(steps.${refStepId})', ` +
              `then (3) reference 'steps.<transform_step>.${field}' instead. ` +
              `Alternatively, evaluate the raw string directly (e.g. 'steps.${refStepId}.includes("...")').`,
          );
        }
        if (outputType === "boolean") {
          throw new ComposerError(
            `Step "${step.id}" accesses ".${field}" on step "${refStepId}" (conditional), ` +
              `but conditional results are booleans with no properties. ` +
              `Use the boolean value directly: 'steps.${refStepId} === true'.`,
          );
        }
      }
    }
  }
}

export function validateSafeWorkflowExpressions(
  steps: ComposeStepInput[],
): void {
  for (const step of steps) {
    if (step.config.type === "transform") {
      validateSafeExpression(
        autoReturnExpression((step.config as TransformStep).expression),
        `transform step "${step.id}"`,
      );
    } else if (step.config.type === "conditional") {
      validateSafeExpression(
        (step.config as ConditionalStep).condition,
        `conditional step "${step.id}"`,
      );
    }
  }
}

/**
 * Auto-infer a `responseSchema` for JSON-mode sampling steps from the way
 * downstream steps access their result.
 *
 * When a later step reads `steps.<sampling>.<field>` (dot or bracket notation),
 * the field name — and a coarse type inferred from how it is used — is recorded
 * on the sampling step's `responseSchema`. This makes the structured shape the
 * workflow depends on explicit instead of implicit, and lets the runtime/provider
 * steer the model toward returning those fields. A `SAMPLING_SCHEMA_MISMATCH`
 * warning is emitted when a consumed field is never mentioned in the prompt, since
 * the model is then unlikely to produce it.
 *
 * Only JSON-mode sampling steps are considered (see {@link isJsonModeSampling});
 * plain-text sampling steps that are field-accessed are rejected earlier by
 * {@link validateDataFlowTypes}.
 */
export function inferSamplingResponseSchemas(
  steps: ComposeStepInput[],
): ComposerWarning[] {
  const warnings: ComposerWarning[] = [];

  const jsonSamplingIds = new Set<string>();
  for (const step of steps) {
    if (step.config.type === "sampling" && isJsonModeSampling(step.config)) {
      jsonSamplingIds.add(step.id);
    }
  }
  if (jsonSamplingIds.size === 0) return warnings;

  // For each JSON sampling step: field name -> inferred JSON type.
  const fieldAccesses = new Map<string, Map<string, string>>();
  for (const id of jsonSamplingIds) fieldAccesses.set(id, new Map());

  // Dot access: steps.X.field or steps.X?.field, optionally followed by a
  // usage hint (=== bool, .join/.map/.filter/.length) we use to guess the type.
  const FIELD_CONTEXT_RE =
    /steps\.(\w+)\??\.(\w+)\s*(?:===\s*(true|false)|\.join\b|\.map\b|\.filter\b|\.length\b|\.includes\b)?/g;
  // Bracket access: steps.X["field"] or steps.X?.["field"]
  const BRACKET_ACCESS_RE = /steps\.(\w+)\??\[\s*(['"])(\w+)\2\s*\]/g;

  function classifyField(
    refId: string,
    field: string,
    boolLiteral: string | undefined,
    tmpl: string,
    matchStart: number,
    matchEnd: number,
  ): void {
    if (!fieldAccesses.has(refId)) return;
    if (JS_BUILTIN_METHODS.has(field)) return;
    const fields = fieldAccesses.get(refId)!;
    if (fields.has(field)) return;

    let inferredType = "string";
    if (boolLiteral === "true" || boolLiteral === "false") {
      inferredType = "boolean";
    } else if (
      /\.join\b|\.map\b|\.filter\b|\.length\b/.test(
        tmpl.slice(matchStart, matchEnd + 10),
      )
    ) {
      inferredType = "array";
    }
    fields.set(field, inferredType);
  }

  for (const step of steps) {
    const templates = extractTemplateStrings(step.config);
    for (const tmpl of templates) {
      for (const match of tmpl.matchAll(FIELD_CONTEXT_RE)) {
        classifyField(
          match[1],
          match[2],
          match[3],
          tmpl,
          match.index!,
          match.index! + match[0].length,
        );
      }
      for (const match of tmpl.matchAll(BRACKET_ACCESS_RE)) {
        classifyField(
          match[1],
          match[3],
          undefined,
          tmpl,
          match.index!,
          match.index! + match[0].length,
        );
      }
    }
  }

  for (const [stepId, fields] of fieldAccesses) {
    if (fields.size === 0) continue;
    const step = steps.find((s) => s.id === stepId)!;
    if (step.config.type !== "sampling") continue;
    const cfg = step.config;

    const schema: Record<string, string> = {};
    for (const [name, type] of fields) schema[name] = type;
    cfg.responseSchema = schema;

    const promptText =
      `${cfg.prompt || ""} ${cfg.systemPrompt || ""}`.toLowerCase();
    for (const field of fields.keys()) {
      if (!promptText.includes(field.toLowerCase())) {
        warnings.push({
          stepId,
          code: "SAMPLING_SCHEMA_MISMATCH",
          message: `Step "${stepId}" result field "${field}" is used by downstream steps but not mentioned in the sampling prompt — the AI may not include it.`,
        });
      }
    }
  }

  return warnings;
}
