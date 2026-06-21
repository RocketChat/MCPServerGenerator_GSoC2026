import type { StepConfig } from "../workflow/types.js";
import type { ComposeStepInput } from "./types.js";

export const STEP_REF_RE = /\{\{steps\.(\w+)/g;
export const PARAM_REF_RE = /\{\{params\.([\w.]+)/g;
export const BARE_STEP_REF_RE = /\bsteps\.(\w+)/g;
export const BARE_PARAM_REF_RE = /\bparams\.([\w]+(?:\.[\w]+)*)/g;
export const STEP_FIELD_ACCESS_RE = /steps\.(\w+)\.(\w+)/g;

export const JS_BUILTIN_METHODS = new Set([
  "includes",
  "indexOf",
  "lastIndexOf",
  "startsWith",
  "endsWith",
  "match",
  "matchAll",
  "search",
  "replace",
  "replaceAll",
  "slice",
  "substring",
  "substr",
  "trim",
  "trimStart",
  "trimEnd",
  "toLowerCase",
  "toUpperCase",
  "split",
  "repeat",
  "padStart",
  "padEnd",
  "charAt",
  "charCodeAt",
  "codePointAt",
  "at",
  "concat",
  "normalize",
  "map",
  "filter",
  "find",
  "findIndex",
  "every",
  "some",
  "reduce",
  "forEach",
  "flat",
  "flatMap",
  "join",
  "reverse",
  "sort",
  "push",
  "pop",
  "shift",
  "unshift",
  "fill",
  "copyWithin",
  "entries",
  "keys",
  "values",
  "toString",
  "valueOf",
  "toJSON",
  "hasOwnProperty",
  "length",
]);

export function findLiteralRid(mapping: Record<string, unknown>): string | null {
  function check(val: unknown): string | null {
    if (typeof val === "string" && !val.includes("{{")) return val;
    return null;
  }
  if ("rid" in mapping) {
    const lit = check(mapping.rid);
    if (lit) return lit;
  }
  for (const v of Object.values(mapping)) {
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      const nested = v as Record<string, unknown>;
      if ("rid" in nested) {
        const lit = check(nested.rid);
        if (lit) return lit;
      }
    }
  }
  return null;
}

export function collectStringsDeep(obj: unknown, out: string[]): void {
  if (typeof obj === "string") {
    out.push(obj);
  } else if (Array.isArray(obj)) {
    for (const item of obj) collectStringsDeep(item, out);
  } else if (typeof obj === "object" && obj !== null) {
    for (const val of Object.values(obj)) collectStringsDeep(val, out);
  }
}

export function extractTemplateStrings(config: StepConfig): string[] {
  const strings: string[] = [];
  switch (config.type) {
    case "api_call": {
      if (config.inputMapping) {
        collectStringsDeep(
          config.inputMapping as Record<string, unknown>,
          strings,
        );
      }
      if (config.forEach) strings.push(config.forEach);
      break;
    }
    case "sampling": {
      strings.push(config.prompt);
      if (config.systemPrompt) strings.push(config.systemPrompt);
      if (config.content) {
        for (const item of config.content) {
          if (item.type === "text") strings.push(item.text);
          else if (item.type === "image") strings.push(item.url);
        }
      }
      break;
    }
    case "elicitation": {
      strings.push(config.message);
      break;
    }
    case "transform": {
      strings.push(config.expression);
      break;
    }
    case "conditional": {
      strings.push(config.condition);
      break;
    }
  }
  return strings;
}

export function extractStepRefs(config: StepConfig): Set<string> {
  const refs = new Set<string>();
  const isJsContext =
    config.type === "transform" || config.type === "conditional";
  for (const str of extractTemplateStrings(config)) {
    for (const match of str.matchAll(STEP_REF_RE)) {
      refs.add(match[1]);
    }
    if (isJsContext) {
      for (const match of str.matchAll(BARE_STEP_REF_RE)) {
        refs.add(match[1]);
      }
    }
  }
  return refs;
}

export function topologicalSort(steps: ComposeStepInput[]): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const step of steps) {
    inDegree.set(step.id, 0);
    adj.set(step.id, []);
  }

  for (const step of steps) {
    for (const dep of step.dependsOn ?? []) {
      adj.get(dep)!.push(step.id);
      inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const neighbor of adj.get(node) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  return order;
}


