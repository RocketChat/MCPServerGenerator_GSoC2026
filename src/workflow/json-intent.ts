/**
 * Shared heuristic for deciding whether a sampling step is meant to produce JSON.
 *
 * This is the single source of truth for JSON-mode detection. Compose-time
 * data-flow validation uses it to decide whether downstream field access on a
 * sampling result is valid; the runtime sampling executor uses the same helper to
 * decide whether to JSON-parse the model output. Keeping the rule in one place
 * (here, in the workflow layer both consumers share) prevents the two sides from
 * drifting apart.
 */

/** A sampling-like config exposing the free-text fields we inspect for JSON intent. */
export interface JsonIntentInput {
  prompt?: string;
  systemPrompt?: string;
}

/** True when the prompt/systemPrompt signal that the model should respond with JSON. */
export function detectJsonIntent(step: JsonIntentInput): boolean {
  const haystack =
    `${step.systemPrompt || ""} ${step.prompt || ""}`.toLowerCase();
  return (
    haystack.includes("json") ||
    haystack.includes("respond with a json") ||
    haystack.includes("respond only with") ||
    haystack.includes("return a json") ||
    haystack.includes("output format:")
  );
}
