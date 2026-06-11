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

export function buildDotPath(
  dotPath: string,
  value: unknown,
): Record<string, unknown> {
  const segments = dotPath.split(".");
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
): Record<string, unknown> {
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
      );
    } else {
      a[key] = bVal;
    }
  }
  return a;
}
