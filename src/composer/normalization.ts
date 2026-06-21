import type { JSONSchema7 } from "json-schema";
import { INPUT_SCHEMA_BODY_KEY } from "../parser/types.js";
import type {
  ApiCallStep,
  ConditionalStep,
  ElicitationStep,
  SamplingStep,
  TransformStep,
} from "../workflow/types.js";
import { ComposerError, type ComposerWarning, type ComposeStepInput } from "./types.js";

export function normalizeStepFields(steps: ComposeStepInput[]): ComposerWarning[] {
  const warnings: ComposerWarning[] = [];
  for (const step of steps) {
    const cfg = step.config as unknown as Record<string, unknown>;
    if (cfg.type === "api_call") {
      if (cfg.as && !cfg.forEach) {
        delete cfg.as;
        warnings.push({
          stepId: step.id,
          code: "FIELD_STRIPPED",
          message: `Stripped "as" from step "${step.id}" — "as" is only used with "forEach" for iteration. Step results are accessed via steps.${step.id}`,
        });
      }
      if (cfg.forEach && !cfg.as) {
        cfg.as = `${step.id}_item`;
        warnings.push({
          stepId: step.id,
          code: "FIELD_AUTO_SET",
          message: `Auto-set as="${cfg.as}" for step "${step.id}" — "as" names the loop variable in forEach iteration`,
        });
      }
    }
  }
  return warnings;
}


export function normalizeEventParamShorthand(
  steps: ComposeStepInput[],
  params: JSONSchema7,
): ComposerWarning[] {
  const warnings: ComposerWarning[] = [];
  const paramProps = params.properties ? Object.keys(params.properties) : [];
  if (paramProps.length === 0) return warnings;

  // Collect forEach iteration variable names so we don't rewrite them as params
  const forEachAsVars = new Set<string>();
  for (const step of steps) {
    if (step.config.type === "api_call" && (step.config as ApiCallStep).as) {
      forEachAsVars.add((step.config as ApiCallStep).as!);
    }
  }

  const templateRewriters = paramProps
    .filter((name) => !forEachAsVars.has(name))
    .map((name) => ({
      name,
      re: new RegExp(`\\{\\{(?!params\\.)${name}\\.`, "g"),
      replacement: `{{params.${name}.`,
    }));

  const jsRewriters = paramProps
    .filter((name) => !forEachAsVars.has(name))
    .map((name) => ({
      name,
      re: new RegExp(`(?<!\\.)\\b${name}\\.`, "g"),
      replacement: `params.${name}.`,
    }));

  type SubFieldRule = {
    subField: string;
    parent: string;
    templateRe: RegExp;
    templateReplacement: string;
    jsRe: RegExp;
    jsReplacement: string;
  };
  const subFieldRewriters: SubFieldRule[] = [];
  const paramPropSet = new Set(paramProps);

  for (const parentName of paramProps) {
    if (forEachAsVars.has(parentName)) continue;
    const parentSchema = params.properties![parentName] as
      | JSONSchema7
      | undefined;
    if (!parentSchema || typeof parentSchema === "boolean") continue;
    const subProps = parentSchema.properties
      ? Object.keys(parentSchema.properties)
      : [];
    for (const subName of subProps) {
      if (paramPropSet.has(subName)) continue;
      subFieldRewriters.push({
        subField: subName,
        parent: parentName,
        templateRe: new RegExp(`\\{\\{params\\.${subName}\\.`, "g"),
        templateReplacement: `{{params.${parentName}.${subName}.`,
        jsRe: new RegExp(`\\bparams\\.${subName}\\.`, "g"),
        jsReplacement: `params.${parentName}.${subName}.`,
      });
    }
  }

  function rewriteTemplate(
    stepId: string,
    value: string,
    fieldName: string,
  ): string {
    let result = value;
    for (const rule of templateRewriters) {
      const rewritten = result.replace(rule.re, rule.replacement);
      if (rewritten !== result) {
        warnings.push({
          stepId,
          code: "EVENT_PARAM_REWRITTEN",
          message: `Rewritten event param shorthand in ${fieldName}: "${rule.name}." → "params.${rule.name}."`,
        });
        result = rewritten;
      }
    }
    for (const rule of subFieldRewriters) {
      const rewritten = result.replace(
        rule.templateRe,
        rule.templateReplacement,
      );
      if (rewritten !== result) {
        warnings.push({
          stepId,
          code: "EVENT_PARAM_REWRITTEN",
          message: `Rewritten sub-field shorthand in ${fieldName}: "params.${rule.subField}." → "params.${rule.parent}.${rule.subField}."`,
        });
        result = rewritten;
      }
    }
    return result;
  }

  function rewriteJs(stepId: string, value: string, fieldName: string): string {
    let result = value;
    for (const rule of jsRewriters) {
      if (rule.re.test(result)) {
        warnings.push({
          stepId,
          code: "EVENT_PARAM_SHORTHAND",
          message: `Bare param "${rule.name}." in ${fieldName} — both "${rule.name}.x" and "params.${rule.name}.x" work at runtime`,
        });
        rule.re.lastIndex = 0;
      }
    }
    for (const rule of subFieldRewriters) {
      if (rule.jsRe.test(result)) {
        warnings.push({
          stepId,
          code: "EVENT_PARAM_SHORTHAND",
          message: `Bare sub-field "params.${rule.subField}." in ${fieldName} — both "params.${rule.subField}.x" and "params.${rule.parent}.${rule.subField}.x" work at runtime`,
        });
        rule.jsRe.lastIndex = 0;
      }
    }
    return result;
  }

  function rewriteValue(
    stepId: string,
    value: unknown,
    fieldName: string,
  ): unknown {
    if (typeof value === "string")
      return rewriteTemplate(stepId, value, fieldName);
    if (Array.isArray(value))
      return value.map((item, i) =>
        rewriteValue(stepId, item, `${fieldName}[${i}]`),
      );
    if (typeof value === "object" && value !== null) {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = rewriteValue(stepId, v, `${fieldName}.${k}`);
      }
      return result;
    }
    return value;
  }

  for (const step of steps) {
    const cfg = step.config;
    switch (cfg.type) {
      case "api_call": {
        const apiCfg = cfg as ApiCallStep;
        if (apiCfg.inputMapping) {
          apiCfg.inputMapping = rewriteValue(
            step.id,
            apiCfg.inputMapping,
            "inputMapping",
          ) as Record<string, unknown>;
        }
        if (apiCfg.forEach) {
          apiCfg.forEach = rewriteTemplate(step.id, apiCfg.forEach, "forEach");
        }
        break;
      }
      case "sampling": {
        const sCfg = cfg as SamplingStep;
        sCfg.prompt = rewriteTemplate(step.id, sCfg.prompt, "prompt");
        if (sCfg.systemPrompt)
          sCfg.systemPrompt = rewriteTemplate(
            step.id,
            sCfg.systemPrompt,
            "systemPrompt",
          );
        if (sCfg.content) {
          for (const item of sCfg.content) {
            if (item.type === "text")
              item.text = rewriteTemplate(step.id, item.text, "content.text");
          }
        }
        break;
      }
      case "elicitation": {
        const eCfg = cfg as ElicitationStep;
        eCfg.message = rewriteTemplate(step.id, eCfg.message, "message");
        break;
      }
      case "conditional": {
        const cCfg = cfg as ConditionalStep;
        cCfg.condition = rewriteJs(step.id, cCfg.condition, "condition");
        break;
      }
      case "transform": {
        const tCfg = cfg as TransformStep;
        tCfg.expression = rewriteJs(step.id, tCfg.expression, "expression");
        break;
      }
    }
  }

  return warnings;
}

/** Escape for double-quoted JS string literals. */
function escapeStringLiteral(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/** Convert {{#each}}/{{#if}} Handlebars blocks to JS expressions; throws on unsupported/nested blocks. */
function convertHandlebarsBlocks(
  input: string,
  stepId: string,
  fieldName: string,
  warnings: ComposerWarning[],
): string {
  let result = input;

  // Detect unsupported block helpers ({{#unless}}, {{#with}}, etc.)
  const unsupportedBlock = result.match(/\{\{#(?!each\b|if\b)(\w+)/);
  if (unsupportedBlock) {
    throw new ComposerError(
      `Step "${stepId}" field "${fieldName}" uses unsupported Handlebars helper "{{#${unsupportedBlock[1]}}}". ` +
      `The template engine uses {{jsExpression}} syntax. ` +
      `Use JavaScript expressions instead (e.g. array.map(), ternary operators).`,
    );
  }

  // Convert {{#each collection}}...body...{{/each}}
  const eachRe = /\{\{#each\s+([^}]+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
  result = result.replace(eachRe, (_, collection: string, body: string) => {
    const col = collection.trim();

    // Check for nested blocks — bail with clear error
    if (/\{\{#(each|if)\b/.test(body)) {
      throw new ComposerError(
        `Step "${stepId}" field "${fieldName}" uses nested Handlebars blocks which cannot be auto-converted. ` +
        `Use JavaScript expressions instead. Example: ` +
        `{{${col}.map(item => item.name + ": " + item.value).join("\\n")}}`,
      );
    }

    // Split body into static parts and dynamic {{this.X}} / {{this}} references
    // Build: collection.map(item => "static" + (item.field ?? "") + "static").join("")
    const parts: string[] = [];
    let lastIndex = 0;
    const refRe = /\{\{this(?:\.(\w+(?:\.\w+)*))?\}\}/g;
    let match;
    while ((match = refRe.exec(body)) !== null) {
      // Static part before this reference
      if (match.index > lastIndex) {
        parts.push(
          `"${escapeStringLiteral(body.slice(lastIndex, match.index))}"`,
        );
      }
      // Dynamic part
      const fieldPath = match[1];
      if (fieldPath) {
        parts.push(`(item.${fieldPath} ?? "")`);
      } else {
        parts.push(`(item ?? "")`);
      }
      lastIndex = match.index + match[0].length;
    }
    // Trailing static part
    if (lastIndex < body.length) {
      parts.push(`"${escapeStringLiteral(body.slice(lastIndex))}"`);
    }

    const mapBody = parts.length > 0 ? parts.join(" + ") : '""';
    const expr = `{{${col}.map(item => ${mapBody}).join("")}}`;

    // Validate the generated expression compiles
    try {
      const innerExpr = expr.slice(2, -2); // strip {{ }}
      new Function("steps", "params", `"use strict"; return (${innerExpr});`);
    } catch {
      throw new ComposerError(
        `Step "${stepId}" field "${fieldName}": auto-converted Handlebars {{#each}} failed to compile. ` +
        `Original: "${_.trim()}". Converted: "${expr}". ` +
        `Use JavaScript expressions directly instead.`,
      );
    }

    warnings.push({
      stepId,
      code: "FIELD_STRIPPED",
      message: `Auto-converted Handlebars {{#each}} to JS in ${fieldName}`,
    });
    return expr;
  });

  // Convert {{#if cond}}...then...{{else}}...else...{{/if}}
  // and {{#if cond}}...then...{{/if}}
  const ifElseRe =
    /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{else\}\}([\s\S]*?)\{\{\/if\}\}/g;
  result = result.replace(
    ifElseRe,
    (_, condition: string, thenBody: string, elseBody: string) => {
      const cond = condition.trim();
      if (
        /\{\{#(each|if)\b/.test(thenBody) ||
        /\{\{#(each|if)\b/.test(elseBody)
      ) {
        throw new ComposerError(
          `Step "${stepId}" field "${fieldName}" uses nested Handlebars blocks inside {{#if}} which cannot be auto-converted.`,
        );
      }
      const thenStr = escapeStringLiteral(thenBody);
      const elseStr = escapeStringLiteral(elseBody);
      warnings.push({
        stepId,
        code: "FIELD_STRIPPED",
        message: `Auto-converted Handlebars {{#if}}...{{else}} to JS ternary in ${fieldName}`,
      });
      return `{{${cond} ? "${thenStr}" : "${elseStr}"}}`;
    },
  );

  const ifOnlyRe = /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
  result = result.replace(
    ifOnlyRe,
    (_, condition: string, thenBody: string) => {
      const cond = condition.trim();
      if (/\{\{#(each|if)\b/.test(thenBody)) {
        throw new ComposerError(
          `Step "${stepId}" field "${fieldName}" uses nested Handlebars blocks inside {{#if}} which cannot be auto-converted.`,
        );
      }
      const thenStr = escapeStringLiteral(thenBody);
      warnings.push({
        stepId,
        code: "FIELD_STRIPPED",
        message: `Auto-converted Handlebars {{#if}} to JS ternary in ${fieldName}`,
      });
      return `{{${cond} ? "${thenStr}" : ""}}`;
    },
  );

  return result;
}

export function normalizeTemplateFields(steps: ComposeStepInput[]): ComposerWarning[] {
  const warnings: ComposerWarning[] = [];

  const asVars = new Set<string>();
  for (const step of steps) {
    if (step.config.type === "api_call" && (step.config as ApiCallStep).as) {
      asVars.add((step.config as ApiCallStep).as!);
    }
  }

  function normalizeString(
    stepId: string,
    value: string,
    fieldName: string,
  ): string {
    // Collapse \n / \\n / \\\n → real newline (LLMs often multi-escape in JSON tool args)
    let result = value.replace(/\\+n/g, "\n").replace(/\\+t/g, "\t");

    // First: convert any Handlebars block syntax to JS expressions
    result = /\{\{#/.test(result)
      ? convertHandlebarsBlocks(result, stepId, fieldName, warnings)
      : result;

    if (/^(steps|params)\.\w+(\.\w+)*$/.test(result)) {
      const wrapped = `{{${result}}}`;
      warnings.push({
        stepId,
        code: "TEMPLATE_AUTO_WRAPPED",
        message: `Auto-wrapped bare reference in ${fieldName}: "${value}" → "${wrapped}"`,
      });
      result = wrapped;
    }

    for (const asVar of asVars) {
      const asRefRe = new RegExp(
        `\\{\\{${asVar}\\.(\\w+(?:\\.\\w+)*)\\}\\}`,
        "g",
      );
      const rewritten = result.replace(asRefRe, `{{steps.${asVar}.$1}}`);
      if (rewritten !== result) {
        warnings.push({
          stepId,
          code: "AS_VAR_REWRITTEN",
          message: `Rewritten as-variable reference in ${fieldName}: "${result}" → "${rewritten}"`,
        });
        result = rewritten;
      }
    }

    // Auto-strip legacy .result. from step references (Gemini training data may still emit it)
    const stripped = result.replace(/\{\{(steps\.\w+)\.result\./g, "{{$1.");
    if (stripped !== result) {
      warnings.push({
        stepId,
        code: "FIELD_STRIPPED",
        message: `Auto-stripped legacy .result from step reference in ${fieldName}: "${result}" → "${stripped}"`,
      });
      result = stripped;
    }

    return result;
  }

  function normalizeValue(
    stepId: string,
    value: unknown,
    fieldName: string,
  ): unknown {
    if (typeof value === "string") {
      // Detect stringified JSON objects/arrays and parse them back to native types
      if (/^\s*[\[{]/.test(value)) {
        try {
          const parsed = JSON.parse(value);
          if (typeof parsed === "object" && parsed !== null) {
            warnings.push({
              stepId,
              code: "STRINGIFIED_JSON_PARSED",
              message: `Auto-parsed stringified JSON in ${fieldName}: "${value.length > 60 ? value.slice(0, 60) + "..." : value}"`,
            });
            return normalizeValue(stepId, parsed, fieldName);
          }
        } catch { }
      }
      return normalizeString(stepId, value, fieldName);
    }
    if (Array.isArray(value)) {
      return value.map((item, i) =>
        normalizeValue(stepId, item, `${fieldName}[${i}]`),
      );
    }
    if (typeof value === "object" && value !== null) {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = normalizeValue(stepId, v, `${fieldName}.${k}`);
      }
      return result;
    }
    return value;
  }

  for (const step of steps) {
    const cfg = step.config;
    switch (cfg.type) {
      case "api_call": {
        const apiCfg = cfg as ApiCallStep;

        if (apiCfg.inputMapping) {
          const keys = Object.keys(apiCfg.inputMapping);
          if (
            keys.length === 1 &&
            (keys[0] === INPUT_SCHEMA_BODY_KEY || keys[0] === "body")
          ) {
            const inner = apiCfg.inputMapping[keys[0]];
            if (
              typeof inner === "object" &&
              inner !== null &&
              !Array.isArray(inner)
            ) {
              apiCfg.inputMapping = inner as Record<string, unknown>;
              warnings.push({
                stepId: step.id,
                code: "REQUEST_BODY_UNWRAPPED",
                message: `Auto-unwrapped "${keys[0]}" wrapper in inputMapping for step "${step.id}".`,
              });
            }
          }
        }

        if (apiCfg.inputMapping) {
          apiCfg.inputMapping = normalizeValue(
            step.id,
            apiCfg.inputMapping,
            "inputMapping",
          ) as Record<string, unknown>;
        }
        if (apiCfg.forEach) {
          apiCfg.forEach = normalizeString(step.id, apiCfg.forEach, "forEach");
        }
        break;
      }
      case "sampling": {
        const sCfg = cfg as SamplingStep;
        sCfg.prompt = normalizeString(step.id, sCfg.prompt, "prompt");
        if (sCfg.systemPrompt) {
          sCfg.systemPrompt = normalizeString(
            step.id,
            sCfg.systemPrompt,
            "systemPrompt",
          );
        }
        if (sCfg.content) {
          for (const item of sCfg.content) {
            if (item.type === "text") {
              item.text = normalizeString(step.id, item.text, "content.text");
            }
          }
        }
        break;
      }
      case "elicitation": {
        const eCfg = cfg as ElicitationStep;
        eCfg.message = normalizeString(step.id, eCfg.message, "message");
        break;
      }
      // transform and conditional use raw JS — do NOT normalize templates,
      // but DO strip legacy .result references
      case "transform": {
        const tCfg = cfg as TransformStep;
        const stripped = tCfg.expression.replace(
          /\bsteps\.(\w+)\.result\b/g,
          "steps.$1",
        );
        if (stripped !== tCfg.expression) {
          warnings.push({
            stepId: step.id,
            code: "FIELD_STRIPPED",
            message: `Auto-stripped legacy .result from transform expression: "${tCfg.expression}" → "${stripped}"`,
          });
          tCfg.expression = stripped;
        }
        break;
      }
      case "conditional": {
        const cCfg = cfg as ConditionalStep;
        const stripped = cCfg.condition.replace(
          /\bsteps\.(\w+)\.result\b/g,
          "steps.$1",
        );
        if (stripped !== cCfg.condition) {
          warnings.push({
            stepId: step.id,
            code: "FIELD_STRIPPED",
            message: `Auto-stripped legacy .result from conditional: "${cCfg.condition}" → "${stripped}"`,
          });
          cCfg.condition = stripped;
        }
        break;
      }
    }
  }

  return warnings;
}

export function flattenNestedSteps(steps: ComposeStepInput[]): ComposerWarning[] {
  const warnings: ComposerWarning[] = [];
  const extracted: ComposeStepInput[] = [];

  for (const step of steps) {
    const cfg = step.config as unknown as Record<string, unknown>;
    for (const key of ["steps", "subSteps"] as const) {
      const nested = cfg[key];
      if (!Array.isArray(nested)) continue;
      for (const sub of nested) {
        if (sub && typeof sub === "object" && sub.id) {
          const subStep: ComposeStepInput = {
            id: sub.id,
            label: sub.label ?? sub.id,
            config: sub.config ?? sub,
            dependsOn: [step.id],
          };
          extracted.push(subStep);
          warnings.push({
            stepId: step.id,
            code: "IMPLICIT_DEP_ADDED",
            message: `Flattened nested step "${sub.id}" from "${step.id}.${key}" to top-level with dependsOn: ["${step.id}"]`,
          });
        }
      }
      delete cfg[key];
    }
  }

  steps.push(...extracted);
  return warnings;
}

