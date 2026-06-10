export interface OperationIdMatch {
  matched: string;
  method: "exact" | "normalized" | "fuzzy";
  distance?: number;
}

/**
 * Resolve an operationId through exact, separator-normalized, then fuzzy matching.
 * Fuzzy matching strips separators, uses the closest candidate with edit distance <= 2, and is skipped for short normalized IDs to avoid false positives on compact APIs.
 */
export function resolveOperationId(
  requested: string,
  candidates: readonly string[],
): OperationIdMatch | null {
  if (candidates.includes(requested)) {
    return { matched: requested, method: "exact" };
  }

  const normalizeSeparators = (s: string) =>
    s.toLowerCase().replace(/[_-]/g, "-");
  const requestedNormalized = normalizeSeparators(requested);

  for (const candidate of candidates) {
    if (normalizeSeparators(candidate) === requestedNormalized) {
      return { matched: candidate, method: "normalized" };
    }
  }

  const stripSeparators = (s: string) => s.toLowerCase().replace(/[_-]/g, "");
  const requestedStripped = stripSeparators(requested);

  const MIN_LENGTH_FOR_FUZZY = 12;
  if (requestedStripped.length < MIN_LENGTH_FOR_FUZZY) {
    return null;
  }

  const MAX_DISTANCE = 2;
  let bestMatch = "";
  let bestDistance = MAX_DISTANCE + 1;

  for (const candidate of candidates) {
    const distance = levenshtein(requestedStripped, stripSeparators(candidate));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = candidate;
    }
  }

  if (bestMatch && bestDistance <= MAX_DISTANCE) {
    return {
      matched: bestMatch,
      method: "fuzzy",
      distance: bestDistance,
    };
  }

  return null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[n];
}
