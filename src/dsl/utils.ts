import { DslParseError } from "./types.js";

/**
 * Object keys that can corrupt the prototype chain when assigned dynamically.
 * These are rejected in MAP paths and MAP values to prevent prototype
 * pollution in the generated input payloads.
 */
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function assertSafeKey(key: string, lineNumber: number): void {
  if (key === "") {
    throw new DslParseError(
      lineNumber,
      'MAP path has an empty segment (e.g. "a..b" or a leading/trailing dot)',
    );
  }
  if (FORBIDDEN_KEYS.has(key)) {
    throw new DslParseError(
      lineNumber,
      `MAP path segment "${key}" is a reserved key and is not allowed`,
    );
  }
}

/**
 * Recursively rejects reserved keys anywhere inside a parsed MAP value, so a
 * JSON literal like {"__proto__": {...}} cannot smuggle a prototype-pollution
 * payload past the dot-path check.
 */
export function assertNoReservedKeys(value: unknown, lineNumber: number): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoReservedKeys(item, lineNumber);
    return;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new DslParseError(
          lineNumber,
          `MAP value contains reserved key "${key}", which is not allowed`,
        );
      }
      assertNoReservedKeys((value as Record<string, unknown>)[key], lineNumber);
    }
  }
}

export function isBlockBoundary(line: string): boolean {
  return (
    line.startsWith("STEP ") ||
    line === "STEP" ||
    line.startsWith("WORKFLOW ") ||
    line === "WORKFLOW" ||
    line.startsWith("PROJECT ") ||
    line === "PROJECT" ||
    line.startsWith("WEBHOOK ") ||
    line === "WEBHOOK"
  );
}

export function isWorkflowBoundary(line: string): boolean {
  return (
    line.startsWith("WORKFLOW ") ||
    line === "WORKFLOW" ||
    line.startsWith("PROJECT ") ||
    line === "PROJECT" ||
    line.startsWith("WEBHOOK ") ||
    line === "WEBHOOK"
  );
}

export function parseValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return "";

  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  // Keep template expressions like {{params.count}} as strings.
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // MAP values that look like JSON can still be plain strings.
    }
  }

  return trimmed;
}

/** Guards against pathological MAP paths and deeply nested MAP values. */
const MAX_DOT_PATH_DEPTH = 10;
const MAX_MERGE_DEPTH = 20;

export function buildDotPath(
  dotPath: string,
  value: unknown,
  lineNumber: number,
): Record<string, unknown> {
  const segments = dotPath.split(".");
  if (segments.length > MAX_DOT_PATH_DEPTH) {
    throw new DslParseError(
      lineNumber,
      `MAP path exceeds maximum nesting depth (${MAX_DOT_PATH_DEPTH})`,
    );
  }
  for (const segment of segments) {
    assertSafeKey(segment, lineNumber);
  }
  if (segments.length === 1) {
    return { [segments[0]]: value };
  }

  const result: Record<string, unknown> = {};
  let current = result;
  for (let i = 0; i < segments.length - 1; i++) {
    const next: Record<string, unknown> = {};
    current[segments[i]] = next;
    current = next;
  }
  current[segments[segments.length - 1]] = value;
  return result;
}

// Mutates target; arrays are replaced instead of merged.
export function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  if (depth > MAX_MERGE_DEPTH) {
    throw new DslParseError(
      0,
      `MAP value nesting too deep (exceeds ${MAX_MERGE_DEPTH} levels)`,
    );
  }
  for (const [key, bVal] of Object.entries(b)) {
    const aVal = a[key];
    if (
      aVal &&
      typeof aVal === "object" &&
      !Array.isArray(aVal) &&
      bVal &&
      typeof bVal === "object" &&
      !Array.isArray(bVal)
    ) {
      deepMerge(
        aVal as Record<string, unknown>,
        bVal as Record<string, unknown>,
        depth + 1,
      );
    } else {
      a[key] = bVal;
    }
  }
  return a;
}
