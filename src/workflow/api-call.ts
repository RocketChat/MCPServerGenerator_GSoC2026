import type { ApiCallStep, WorkflowStep } from "./types.js";
import type {
  EndpointInfo,
  ExecutionState,
  WorkflowClient,
} from "./executor.js";
import { evaluateExpression, resolveMapping } from "./templates.js";

const DEFAULT_FOREACH_CONCURRENCY = 5;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Walk a dotted path into a parsed value, returning null on any miss. */
export function extractPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc != null && typeof acc === "object" && !Array.isArray(acc)) {
      return (acc as Record<string, unknown>)[key] ?? null;
    }
    return null;
  }, value);
}

/** Build a `path?query` string from a payload for GET requests. */
function buildGetUrl(path: string, payload: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(payload)) {
    search.append(
      k,
      typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? ""),
    );
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * Drop optional params that resolved to empty because their referenced source
 * does not exist; throw when a referenced source exists but is empty/broken so
 * the failure is visible rather than silently producing a bad request.
 */
function pruneEmptyParams(
  step: ApiCallStep,
  payload: Record<string, unknown>,
  state: ExecutionState,
): void {
  for (const [key, raw] of Object.entries(step.inputMapping)) {
    if (typeof raw !== "string" || !raw.includes("{{")) continue;
    const resolved = payload[key];
    if (resolved !== "" && resolved !== undefined && resolved !== null)
      continue;

    const paramMatch = raw.match(/\{\{\s*params\.(\w+)/);
    const stepMatch = raw.match(/\{\{\s*steps\.(\w+)/);
    if (paramMatch && !(paramMatch[1] in state.params)) {
      delete payload[key];
    } else if (stepMatch && !(stepMatch[1] in state.steps)) {
      delete payload[key];
    } else {
      throw new Error(
        `Parameter "${key}" resolved to empty (template: ${raw}).`,
      );
    }
  }
}

async function callOnce(
  step: ApiCallStep,
  payload: Record<string, unknown>,
  state: ExecutionState,
  client: WorkflowClient,
  endpoints: Record<string, EndpointInfo>,
): Promise<unknown> {
  const endpoint: EndpointInfo | undefined = endpoints[step.operationId];
  const method = (endpoint?.method || "GET").toUpperCase();
  const path = endpoint?.path || "";

  pruneEmptyParams(step, payload, state);

  if (method === "GET") {
    // Decode JSON-looking string values so they ride along as query params.
    for (const [k, v] of Object.entries(payload)) {
      if (typeof v === "string" && /^[[{]/.test(v)) {
        try {
          payload[k] = JSON.parse(v);
        } catch {
          // keep as string
        }
      }
    }
  }

  const response = await client.request(
    method,
    method === "GET" ? buildGetUrl(path, payload) : path,
    { auth: true, ...(method !== "GET" ? { body: payload } : {}) },
  );

  if (!response.ok) {
    const detail =
      typeof response.data === "string"
        ? response.data
        : JSON.stringify(response.data);
    throw new Error(
      `API call "${step.operationId}" failed (status ${response.status}): ${detail}`,
    );
  }

  if (
    typeof response.data === "string" &&
    response.data.length > MAX_RESPONSE_BYTES
  ) {
    throw new Error(
      `API response for "${step.operationId}" exceeds the 10 MB limit.`,
    );
  }

  return step.outputPath
    ? extractPath(response.data, step.outputPath)
    : response.data;
}

/** Execute an `api_call` step, including its optional `forEach` fan-out. */
export async function executeApiCall(
  step: WorkflowStep,
  state: ExecutionState,
  client: WorkflowClient,
  endpoints: Record<string, EndpointInfo>,
  maxForEachIterations: number,
): Promise<void> {
  const config = step.config as ApiCallStep;

  if (config.forEach && config.as) {
    const itemVar = config.as;
    // The composer stores forEach as a bare expression (template braces are
    // stripped during inference); evaluate it directly. Tolerate residual
    // `{{ }}` wrapping defensively.
    const expr = config.forEach.trim();
    const cleaned =
      expr.startsWith("{{") && expr.endsWith("}}")
        ? expr.slice(2, -2).trim()
        : expr;
    let raw: unknown;
    try {
      raw = evaluateExpression(cleaned, state.params, state.steps);
    } catch {
      raw = [];
    }
    const collection = Array.isArray(raw) ? raw : [];
    if (collection.length > maxForEachIterations) {
      throw new Error(
        `Step "${step.id}" forEach has ${collection.length} items, ` +
          `exceeding the maximum of ${maxForEachIterations}.`,
      );
    }

    const results: unknown[] = new Array(collection.length).fill(null);
    for (let i = 0; i < collection.length; i += DEFAULT_FOREACH_CONCURRENCY) {
      const slice = collection.slice(i, i + DEFAULT_FOREACH_CONCURRENCY);
      const settled = await Promise.allSettled(
        slice.map((item) => {
          const locals = { [itemVar]: item };
          const augmentedSteps = { ...state.steps, [itemVar]: item };
          const payload = resolveMapping(
            config.inputMapping,
            state.params,
            augmentedSteps,
            locals,
          );
          return callOnce(config, payload, state, client, endpoints);
        }),
      );
      for (let j = 0; j < settled.length; j++) {
        const r = settled[j];
        if (r.status === "fulfilled") results[i + j] = r.value;
      }
    }

    state.steps[step.id] = results;
    state.status[step.id] = "success";
    state.completed.push(step.id);
    return;
  }

  const payload = resolveMapping(
    config.inputMapping,
    state.params,
    state.steps,
  );
  const result = await callOnce(config, payload, state, client, endpoints);
  state.steps[step.id] = result;
  state.status[step.id] = "success";
  state.completed.push(step.id);
}
