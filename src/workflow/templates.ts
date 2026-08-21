import vm from "node:vm";
import {
  autoReturnExpression,
  validateSafeExpression,
} from "./expression-security.js";

/**
 * SECURITY MODEL
 * --------------
 * The security boundary for workflow expressions is the AST allowlist in
 * `expression-security.ts` (`validateSafeExpression`), NOT Node's `vm` module.
 * `node:vm` is explicitly documented as *not* a sandbox for untrusted code — a
 * determined expression can reach the host realm. Every expression is therefore
 * statically validated against the allowlist *before* it is passed to the VM;
 * the VM only adds a wall-clock `timeout` as defense-in-depth.
 *
 * The timeout interrupts synchronous CPU loops but does NOT bound memory. Inputs
 * are expected to be author/AI-generated and validated, not adversarial. If this
 * engine is ever exposed to untrusted expression authors, replace `vm` with a
 * hard-isolation runtime (e.g. `isolated-vm`) and add a memory limit.
 */

const VM_TIMEOUT_MS = 250;

type Scope = Record<string, unknown>;

const JS_RESERVED = new Set([
  "arguments",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "eval",
  "export",
  "extends",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

function isValidName(name: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) && !JS_RESERVED.has(name);
}

/**
 * Build the prototype-less sandbox object exposed to an expression. Params and
 * forEach locals are spread in as bare identifiers so authors can write
 * `roomName` instead of `params.roomName`, while `params` and `steps` remain
 * available for fully-qualified access.
 */
function buildSandbox(params: Scope, steps: Scope, locals: Scope = {}): Scope {
  const sandbox: Scope = Object.create(null);
  sandbox.params = params;
  sandbox.steps = steps;
  for (const [k, v] of Object.entries(params)) {
    if (isValidName(k)) sandbox[k] = v;
  }
  for (const [k, v] of Object.entries(locals)) {
    if (isValidName(k)) sandbox[k] = v;
  }
  // Safe globals — the same set the allowlist permits as callees.
  sandbox.Array = Array;
  sandbox.Boolean = Boolean;
  sandbox.Date = Date;
  sandbox.JSON = JSON;
  sandbox.Math = Math;
  sandbox.Number = Number;
  sandbox.Object = Object;
  sandbox.String = String;
  sandbox.parseInt = parseInt;
  sandbox.parseFloat = parseFloat;
  sandbox.isNaN = isNaN;
  sandbox.isFinite = isFinite;
  sandbox.encodeURIComponent = encodeURIComponent;
  sandbox.decodeURIComponent = decodeURIComponent;
  sandbox.undefined = undefined;
  sandbox.NaN = NaN;
  sandbox.Infinity = Infinity;
  return sandbox;
}

/** Identifiers in scope for an expression — mirrors the bare names {@link buildSandbox} defines. */
function getScopeNames(
  params: Scope,
  steps: Scope,
  locals: Scope = {},
): string[] {
  const names = new Set<string>(["params", "steps"]);
  for (const k of Object.keys(params)) {
    if (isValidName(k)) names.add(k);
  }
  for (const k of Object.keys(locals)) {
    if (isValidName(k)) names.add(k);
  }
  return [...names];
}

function runInSandbox(code: string, sandbox: Scope): unknown {
  return vm.runInNewContext(code, sandbox, { timeout: VM_TIMEOUT_MS });
}

/** Evaluate a single expression and return its native value. */
export function evaluateExpression(
  expr: string,
  params: Scope,
  steps: Scope,
  locals: Scope = {},
): unknown {
  validateSafeExpression(
    expr,
    "expression",
    getScopeNames(params, steps, locals),
  );
  const sandbox = buildSandbox(params, steps, locals);
  return runInSandbox(`"use strict"; (${expr});`, sandbox);
}

/**
 * Evaluate a transform block. A bare expression is tried first; if it is not a
 * valid expression (e.g. it contains statements or a trailing object literal),
 * the block is auto-wrapped with a `return` and run inside an IIFE.
 */
export function evaluateExpressionBlock(
  expr: string,
  params: Scope,
  steps: Scope,
  locals: Scope = {},
): unknown {
  const withReturn = autoReturnExpression(expr);
  const scopeNames = getScopeNames(params, steps, locals);
  validateSafeExpression(expr, "transform", scopeNames);
  validateSafeExpression(withReturn, "transform", scopeNames);
  const sandbox = buildSandbox(params, steps, locals);
  try {
    return runInSandbox(`"use strict"; (${expr});`, sandbox);
  } catch {
    return runInSandbox(
      `"use strict"; (function() { ${withReturn} })();`,
      sandbox,
    );
  }
}

/** Evaluate a condition expression to a boolean. */
export function evaluateCondition(
  expr: string,
  params: Scope,
  steps: Scope,
): boolean {
  validateSafeExpression(expr, "conditional", getScopeNames(params, steps));
  const sandbox = buildSandbox(params, steps);
  return runInSandbox(`"use strict"; !!(${expr});`, sandbox) as boolean;
}

/**
 * Locate the `}}` that closes a `{{ ... }}` placeholder starting at `from` (the
 * first character after the opening `{{`). Tracks brace depth and skips string
 * literals so braces inside the embedded expression do not terminate early.
 */
function findTemplateClose(
  s: string,
  from: number,
): { exprEnd: number; end: number } | null {
  let depth = 0;
  let i = from;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < s.length) {
        if (s[i] === "\\") {
          i += 2;
          continue;
        }
        if (s[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "{") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}") {
      if (depth > 0) {
        depth--;
        i++;
        continue;
      }
      if (s[i + 1] === "}") return { exprEnd: i, end: i + 2 };
      i++;
      continue;
    }
    i++;
  }
  return null;
}

/**
 * Normalize the template escape forms before evaluation:
 *  - bracket-wrapped refs `{{[params.x]}}` → `{{params.x}}`
 *  - over-braced `{{{ ... }}}` (3+) → `{{ ... }}`
 * Idempotent.
 */
function cleanTemplate(template: string): string {
  return template
    .replace(/\{\{\[params\.([^\]]+)\]\}\}/g, "{{params.$1}}")
    .replace(/\{\{\[steps\.([^\]]+)\]\}\}/g, "{{steps.$1}}")
    .replace(/\{{3,}([^}]+)\}{3,}/g, "{{$1}}");
}

/**
 * If `cleaned` is a single placeholder spanning the entire string, return the
 * inner expression; otherwise `null`. Used to decide whether a value can keep
 * its native (non-string) type.
 */
function soleExpression(cleaned: string): string | null {
  if (!cleaned.startsWith("{{")) return null;
  const close = findTemplateClose(cleaned, 2);
  if (close && close.end === cleaned.length) {
    return cleaned.slice(2, close.exprEnd).trim();
  }
  return null;
}

/** Resolve every `{{ ... }}` placeholder in a string to its stringified value. */
export function resolveTemplate(
  template: string,
  params: Scope,
  steps: Scope,
  locals: Scope = {},
): string {
  const cleaned = cleanTemplate(template);
  const sandbox = buildSandbox(params, steps, locals);
  const scopeNames = getScopeNames(params, steps, locals);

  const resolveExpr = (rawExpr: string, match: string): string => {
    const expr = rawExpr.trim();
    try {
      validateSafeExpression(expr, "template", scopeNames);
      const val = runInSandbox(`"use strict"; (${expr});`, sandbox);
      return typeof val === "object" && val !== null
        ? JSON.stringify(val)
        : String(val ?? "");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[template] Failed to resolve ${match}: ${msg}`);
      return "";
    }
  };

  let result = "";
  let i = 0;
  while (i < cleaned.length) {
    const start = cleaned.indexOf("{{", i);
    if (start === -1) {
      result += cleaned.slice(i);
      break;
    }
    result += cleaned.slice(i, start);
    const close = findTemplateClose(cleaned, start + 2);
    if (close === null) {
      result += cleaned.slice(start);
      break;
    }
    const rawExpr = cleaned.slice(start + 2, close.exprEnd);
    const match = cleaned.slice(start, close.end);
    result += resolveExpr(rawExpr, match);
    i = close.end;
  }
  return result;
}

/**
 * Resolve a value of any shape. Strings containing a single whole-string
 * placeholder keep their native evaluated type; mixed strings interpolate to a
 * string (parsed back only when the whole result is a JSON container). Arrays
 * and objects are resolved recursively.
 */
export function resolveValue(
  value: unknown,
  params: Scope,
  steps: Scope,
  locals: Scope = {},
): unknown {
  if (typeof value === "string" && value.includes("{{")) {
    const cleaned = cleanTemplate(value);
    const sole = soleExpression(cleaned);
    if (sole !== null) {
      try {
        return evaluateExpression(sole, params, steps, locals) ?? "";
      } catch {
        return resolveTemplate(value, params, steps, locals);
      }
    }
    const result = resolveTemplate(value, params, steps, locals);
    const trimmed = result.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.parse(result);
      } catch {
        return result;
      }
    }
    return result;
  }
  if (Array.isArray(value)) {
    return value.map((el) => resolveValue(el, params, steps, locals));
  }
  if (typeof value === "object" && value !== null) {
    return resolveMapping(value as Scope, params, steps, locals);
  }
  return value;
}

/** Resolve every value in a mapping object. */
export function resolveMapping(
  mapping: Scope,
  params: Scope,
  steps: Scope,
  locals: Scope = {},
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(mapping)) {
    resolved[key] = resolveValue(value, params, steps, locals);
  }
  return resolved;
}
