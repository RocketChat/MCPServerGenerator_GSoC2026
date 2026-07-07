import type { SamplingStep, WorkflowStep } from "./types.js";
import type { ExecutionState, WorkflowServer } from "./executor.js";
import { resolveTemplate } from "./templates.js";

/**
 * True when the prompt/systemPrompt signal that the model should respond with
 * JSON. Shared heuristic so runtime parsing and compose-time validation agree.
 */
export function detectJsonIntent(step: {
  prompt?: string;
  systemPrompt?: string;
}): boolean {
  const haystack =
    `${step.systemPrompt || ""} ${step.prompt || ""}`.toLowerCase();
  return (
    haystack.includes("json") ||
    haystack.includes("respond only with") ||
    haystack.includes("output format:")
  );
}

/**
 * Find the bracket that closes the JSON value opened at `start`, tracking depth
 * and skipping string literals. Returns -1 when no balanced closer exists.
 */
function matchingClose(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let quote = "";
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
    } else if (c === "{" || c === "[") {
      depth++;
    } else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Extract the first parseable JSON object/array embedded in `text`. */
export function extractJson(text: string): string | null {
  const MAX_CANDIDATES = 100;
  let tried = 0;
  for (let i = 0; i < text.length && tried < MAX_CANDIDATES; i++) {
    const ch = text[i];
    if (ch !== "{" && ch !== "[") continue;
    const end = matchingClose(text, i);
    if (end === -1) continue;
    tried++;
    const candidate = text.substring(i, end + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // try the next opener
    }
  }
  return null;
}

function buildPrompt(config: SamplingStep, state: ExecutionState): string {
  let prompt: string;
  if (config.content && config.content.length > 0) {
    prompt = config.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => resolveTemplate(c.text, state.params, state.steps))
      .join("\n");
  } else {
    prompt = resolveTemplate(config.prompt || "", state.params, state.steps);
  }

  if (config.responseSchema && Object.keys(config.responseSchema).length > 0) {
    const fields = Object.entries(config.responseSchema)
      .map(([name, type]) => `- ${name} (${type})`)
      .join("\n");
    prompt += `\n\nRespond with a JSON object containing exactly these fields:\n${fields}`;
  }
  return prompt;
}

/** Execute a `sampling` step via the MCP server's `createMessage`. */
export async function executeSampling(
  step: WorkflowStep,
  state: ExecutionState,
  server: WorkflowServer,
): Promise<void> {
  const config = step.config as SamplingStep;
  const jsonMode =
    config.responseFormat === "json" ||
    Boolean(
      config.responseSchema && Object.keys(config.responseSchema).length > 0,
    ) ||
    detectJsonIntent(config);

  const response = await server.createMessage({
    prompt: buildPrompt(config, state),
    systemPrompt: config.systemPrompt
      ? resolveTemplate(config.systemPrompt, state.params, state.steps)
      : undefined,
    maxTokens: config.maxTokens,
  });

  const text = response.content?.text ?? "";
  let result: unknown = text;
  if (jsonMode) {
    try {
      result = JSON.parse(text);
    } catch {
      const extracted = extractJson(text);
      if (extracted !== null) result = JSON.parse(extracted);
    }
  }

  state.steps[step.id] = result;
  state.status[step.id] = "success";
  state.completed.push(step.id);
}
