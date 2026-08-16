import type {
  ApiCallStep,
  ConditionalStep,
  ElicitationStep,
  SamplingStep,
  TransformStep,
} from "../workflow/types.js";
import { ComposerError, type ComposerWarning, type ComposeStepInput } from "./types.js";
import { JS_BUILTIN_METHODS, STEP_REF_RE, BARE_STEP_REF_RE, extractStepRefs, extractTemplateStrings } from "./utils.js";

export function inferMissingConditionalTargets(
  steps: ComposeStepInput[],
): ComposerWarning[] {
  const warnings: ComposerWarning[] = [];

  for (const step of steps) {
    if (step.config.type !== "conditional") continue;
    const cfg = step.config as ConditionalStep;
    if (cfg.thenStep) continue;

    const dependents = steps.filter(
      (s) => s.id !== step.id && s.dependsOn?.includes(step.id),
    );

    if (cfg.elseStep) {
      const candidates = dependents.filter((s) => s.id !== cfg.elseStep);
      if (candidates.length === 1) {
        cfg.thenStep = candidates[0].id;
        warnings.push({
          stepId: step.id,
          code: "FIELD_AUTO_SET",
          message: `Auto-inferred thenStep="${cfg.thenStep}" for conditional "${step.id}" from its dependents.`,
        });
      } else if (candidates.length === 0) {
        throw new ComposerError(
          `Step "${step.id}" (conditional): thenStep is required. ` +
          `Has elseStep="${cfg.elseStep}" but no other step depends on this conditional to infer thenStep from.`,
        );
      } else {
        throw new ComposerError(
          `Step "${step.id}" (conditional): thenStep is required. ` +
          `Multiple steps depend on it [${candidates.map((s) => s.id).join(", ")}] — specify thenStep explicitly.`,
        );
      }
    } else {
      if (dependents.length === 1) {
        cfg.thenStep = dependents[0].id;
        warnings.push({
          stepId: step.id,
          code: "FIELD_AUTO_SET",
          message: `Auto-inferred thenStep="${cfg.thenStep}" for conditional "${step.id}" from its dependents.`,
        });
      } else if (dependents.length === 0) {
        throw new ComposerError(
          `Step "${step.id}" (conditional): thenStep is required. ` +
          `No steps depend on this conditional — cannot infer thenStep.`,
        );
      } else {
        throw new ComposerError(
          `Step "${step.id}" (conditional): thenStep is required. ` +
          `Multiple steps depend on it [${dependents.map((s) => s.id).join(", ")}] — specify thenStep explicitly.`,
        );
      }
    }
  }

  return warnings;
}

export function injectImplicitDependencies(
  steps: ComposeStepInput[],
): ComposerWarning[] {
  const warnings: ComposerWarning[] = [];
  const ids = new Set(steps.map((s) => s.id));

  for (const step of steps) {
    const deps = new Set(step.dependsOn ?? []);

    const refs = extractStepRefs(step.config);
    for (const refId of refs) {
      if (ids.has(refId) && refId !== step.id && !deps.has(refId)) {
        deps.add(refId);
        warnings.push({
          stepId: step.id,
          code: "IMPLICIT_DEP_ADDED",
          message: `Auto-fixed: "${step.id}" references "${refId}" in templates — dependsOn updated automatically (no action needed).`,
        });
      }
    }

    step.dependsOn = deps.size > 0 ? [...deps] : undefined;
  }

  for (const step of steps) {
    if (step.config.type !== "conditional") continue;
    const cfg = step.config as ConditionalStep;
    for (const targetId of [cfg.thenStep, cfg.elseStep]) {
      if (!targetId) continue;
      const target = steps.find((s) => s.id === targetId);
      if (!target) continue;
      const targetDeps = new Set(target.dependsOn ?? []);
      if (!targetDeps.has(step.id)) {
        targetDeps.add(step.id);
        target.dependsOn = [...targetDeps];
        warnings.push({
          stepId: target.id,
          code: "IMPLICIT_DEP_ADDED",
          message: `Auto-fixed: "${target.id}" is a branch target of conditional "${step.id}" — dependsOn updated automatically (no action needed).`,
        });
      }
    }
  }

  return warnings;
}

export function inferSamplingResponseSchemas(
  steps: ComposeStepInput[],
): ComposerWarning[] {
  const warnings: ComposerWarning[] = [];
  const jsonSamplingIds = new Set<string>();
  for (const step of steps) {
    if (step.config.type === "sampling") {
      const cfg = step.config as SamplingStep;
      if (cfg.responseFormat === "json") {
        jsonSamplingIds.add(step.id);
      }
    }
  }
  if (jsonSamplingIds.size === 0) return warnings;

  const fieldAccesses = new Map<string, Map<string, string>>();
  for (const id of jsonSamplingIds) fieldAccesses.set(id, new Map());

  // Regex that captures: steps.<id>.<field> and optionally a trailing method/operator
  const FIELD_CONTEXT_RE =
    /steps\.(\w+)\.(\w+)\s*(?:===\s*(true|false)|\.join\b|\.map\b|\.filter\b|\.length\b|\.includes\b)?/g;

  for (const step of steps) {
    const templates = extractTemplateStrings(step.config);
    for (const tmpl of templates) {
      for (const match of tmpl.matchAll(FIELD_CONTEXT_RE)) {
        const refId = match[1];
        const field = match[2];
        const boolLiteral = match[3];
        if (!fieldAccesses.has(refId)) continue;
        if (JS_BUILTIN_METHODS.has(field)) continue;
        const fields = fieldAccesses.get(refId)!;
        if (fields.has(field)) continue; // first wins

        let inferredType = "string";
        if (boolLiteral === "true" || boolLiteral === "false") {
          inferredType = "boolean";
        } else if (
          /\.join\b|\.map\b|\.filter\b|\.length\b/.test(
            tmpl.slice(match.index!, match.index! + match[0].length + 10),
          )
        ) {
          inferredType = "array";
        }
        fields.set(field, inferredType);
      }
    }
  }

  for (const [stepId, fields] of fieldAccesses) {
    if (fields.size === 0) continue;
    const step = steps.find((s) => s.id === stepId)!;
    const cfg = step.config as SamplingStep;
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

export function inferOutputPath(steps: ComposeStepInput[]): ComposerWarning[] {
  const warnings: ComposerWarning[] = [];
  const apiCallSteps = new Map<string, ApiCallStep>();
  for (const step of steps) {
    if (step.config.type === "api_call") {
      apiCallSteps.set(step.id, step.config as ApiCallStep);
    }
  }
  if (apiCallSteps.size === 0) return warnings;

  const fieldAccesses = new Map<string, Set<string>>();
  for (const [id] of apiCallSteps) fieldAccesses.set(id, new Set());

  for (const step of steps) {
    const strings = extractTemplateStrings(step.config);
    const isJs =
      step.config.type === "transform" || step.config.type === "conditional";
    for (const str of strings) {
      for (const m of str.matchAll(/\{\{steps\.(\w+)\.(\w+)/g)) {
        const [, stepId, field] = m;
        if (fieldAccesses.has(stepId) && !JS_BUILTIN_METHODS.has(field)) {
          fieldAccesses.get(stepId)!.add(field);
        }
      }
      if (isJs) {
        for (const m of str.matchAll(/\bsteps\.(\w+)\??\.(\w+)/g)) {
          const [, stepId, field] = m;
          if (fieldAccesses.has(stepId) && !JS_BUILTIN_METHODS.has(field)) {
            fieldAccesses.get(stepId)!.add(field);
          }
        }
      }
    }
  }

  for (const [stepId, apiCfg] of apiCallSteps) {
    const accessed = fieldAccesses.get(stepId)!;
    if (accessed.size === 0) continue;

    if (apiCfg.outputPath) {
      if (accessed.has(apiCfg.outputPath)) {
        rewriteStepRefs(steps, stepId, apiCfg.outputPath);
        warnings.push({
          stepId,
          code: "OUTPUT_PATH_REF_FIXED",
          message:
            `Redundant extraction fixed: downstream refs used "steps.${stepId}.${apiCfg.outputPath}" ` +
            `but outputPath already extracts "${apiCfg.outputPath}". Refs rewritten to "steps.${stepId}".`,
        });
      }
    } else if (accessed.size === 1) {
      const field = [...accessed][0];
      apiCfg.outputPath = field;
      rewriteStepRefs(steps, stepId, field);
      warnings.push({
        stepId,
        code: "OUTPUT_PATH_INFERRED",
        message:
          `Auto-inferred outputPath "${field}": all downstream refs access "steps.${stepId}.${field}". ` +
          `Refs rewritten to "steps.${stepId}".`,
      });
    }
  }

  return warnings;
}

/** Strip extracted outputPath field from downstream step refs (template + JS + optional chaining). */
function rewriteStepRefs(
  steps: ComposeStepInput[],
  stepId: string,
  field: string,
): void {
  const tmplRe = new RegExp(
    `(\\{\\{steps\\.${stepId})\\.${field}(?=\\.|\\}|\\s|\\))`,
    "g",
  );
  const jsRe = new RegExp(
    `(\\bsteps\\.${stepId})\\??\\.${field}(?=\\??\\.|\\b|\\)|\\s|$|,|;|\\])`,
    "g",
  );

  for (const step of steps) {
    const cfg = step.config;
    const isJs = cfg.type === "transform" || cfg.type === "conditional";
    const activeRe = isJs ? jsRe : tmplRe;

    switch (cfg.type) {
      case "api_call": {
        const apiCfg = cfg as ApiCallStep;
        if (apiCfg.inputMapping) {
          apiCfg.inputMapping = rewriteDeep(
            apiCfg.inputMapping,
            tmplRe,
          ) as Record<string, unknown>;
        }
        if (apiCfg.forEach) {
          apiCfg.forEach = apiCfg.forEach.replace(tmplRe, "$1");
        }
        break;
      }
      case "sampling": {
        const sCfg = cfg as SamplingStep;
        sCfg.prompt = sCfg.prompt.replace(tmplRe, "$1");
        if (sCfg.systemPrompt)
          sCfg.systemPrompt = sCfg.systemPrompt.replace(tmplRe, "$1");
        if (sCfg.content) {
          for (const item of sCfg.content) {
            if (item.type === "text")
              item.text = item.text.replace(tmplRe, "$1");
          }
        }
        break;
      }
      case "elicitation": {
        const eCfg = cfg as ElicitationStep;
        eCfg.message = eCfg.message.replace(tmplRe, "$1");
        break;
      }
      case "transform": {
        const tCfg = cfg as TransformStep;
        tCfg.expression = tCfg.expression.replace(jsRe, "$1");
        tCfg.expression = tCfg.expression.replace(tmplRe, "$1");
        break;
      }
      case "conditional": {
        const cCfg = cfg as ConditionalStep;
        cCfg.condition = cCfg.condition.replace(jsRe, "$1");
        cCfg.condition = cCfg.condition.replace(tmplRe, "$1");
        break;
      }
    }
  }
}

/** Recursively replace in all string values of an object/array. */
function rewriteDeep(value: unknown, re: RegExp): unknown {
  if (typeof value === "string") return value.replace(re, "$1");
  if (Array.isArray(value)) return value.map((item) => rewriteDeep(item, re));
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = rewriteDeep(v, re);
    }
    return result;
  }
  return value;
}

