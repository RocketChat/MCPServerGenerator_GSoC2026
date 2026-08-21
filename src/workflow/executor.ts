import type { JSONSchema7 } from "json-schema";
import type {
  ConditionalStep,
  ElicitationStep,
  TransformStep,
  WorkflowDefinition,
  WorkflowStep,
} from "./types.js";
import {
  evaluateCondition,
  evaluateExpressionBlock,
  resolveTemplate,
} from "./templates.js";
import { executeApiCall } from "./api-call.js";
import { executeSampling } from "./sampling.js";

// ── Runtime contracts ─────────────────────────────────────────────────────────

export interface EndpointInfo {
  method: string;
  path: string;
}

export interface ApiResponse {
  ok: boolean;
  status: number;
  /** Parsed JSON body, or the raw text when the body is not JSON. */
  data: unknown;
}

/** Minimal HTTP surface the engine needs. Generated servers supply a concrete client. */
export interface WorkflowClient {
  request(
    method: string,
    path: string,
    options?: { auth?: boolean; body?: Record<string, unknown> },
  ): Promise<ApiResponse>;
}

export interface SamplingMessage {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
}

/** Minimal MCP server surface the engine needs for sampling and elicitation. */
export interface WorkflowServer {
  createMessage(
    message: SamplingMessage,
  ): Promise<{ content: { type: string; text: string } }>;
  elicitInput?(params: {
    message: string;
    requestedSchema: JSONSchema7;
  }): Promise<{ action: string; content?: unknown }>;
}

export type StepStatus = "success" | "skipped" | "error" | "partial";

export interface ExecutionState {
  params: Record<string, unknown>;
  /** Step results keyed by step id. Exposed to expressions as `steps`. */
  steps: Record<string, unknown>;
  status: Record<string, StepStatus>;
  errors: Record<string, string>;
  completed: string[];
  /** When set, the named step is force-skipped (a not-taken conditional branch). */
  skipStep: string | null;
  /** Tracks which conditional skipped a step and which branch is still live. */
  conditionalSkips: Record<
    string,
    { conditional: string; runningBranchStep: string | null }
  >;
}

export interface RunWorkflowOptions {
  client: WorkflowClient;
  server: WorkflowServer;
  endpoints: Record<string, EndpointInfo>;
  /** Whole-workflow wall-clock budget. Default: 300_000 ms. */
  timeoutMs?: number;
  /** Maximum forEach iterations for a single step. Default: 500. */
  maxForEachIterations?: number;
  /** Cancel the workflow mid-flight. */
  signal?: AbortSignal;
}

export interface WorkflowResult {
  status: "success" | "error" | "aborted" | "partial";
  completedSteps: string[];
  stepResults: Record<string, unknown>;
  stepErrors?: Record<string, string>;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_FOREACH = 500;

// ── Dependency analysis ───────────────────────────────────────────────────────

/** Build the transitive ancestor set for every step id. */
function buildAncestorMap(
  deps: Record<string, string[]>,
): Map<string, Set<string>> {
  const cache = new Map<string, Set<string>>();
  const resolve = (id: string, visiting: Set<string>): Set<string> => {
    const cached = cache.get(id);
    if (cached) return cached;
    if (visiting.has(id)) return new Set();
    visiting.add(id);
    const ancestors = new Set<string>([id]);
    for (const dep of deps[id] || []) {
      for (const a of resolve(dep, visiting)) ancestors.add(a);
    }
    cache.set(id, ancestors);
    return ancestors;
  };
  for (const id of Object.keys(deps)) resolve(id, new Set());
  return cache;
}

function hasAncestor(
  id: string,
  ancestor: string,
  map: Map<string, Set<string>>,
): boolean {
  const ancestors = map.get(id);
  return ancestors ? ancestors.has(ancestor) : id === ancestor;
}

function markSkipped(state: ExecutionState, id: string): void {
  state.steps[id] = null;
  state.status[id] = "skipped";
}

/**
 * Decide whether a step is ready to run now. Side effect: marks the step as
 * skipped when a not-taken conditional branch or an all-skipped dependency set
 * means it can never run.
 */
function shouldRun(
  id: string,
  state: ExecutionState,
  deps: Record<string, string[]>,
  ancestorMap: Map<string, Set<string>>,
): boolean {
  if (state.skipStep === id) {
    state.skipStep = null;
    markSkipped(state, id);
    return false;
  }

  const stepDeps = deps[id] || [];
  const allTerminal = stepDeps.every(
    (d) => state.completed.includes(d) || state.status[d] === "skipped",
  );
  if (!allTerminal) return false;

  for (const dep of stepDeps) {
    if (state.status[dep] !== "skipped") continue;
    const skipInfo = state.conditionalSkips[dep];
    if (!skipInfo) continue;
    const { runningBranchStep } = skipInfo;
    if (runningBranchStep && hasAncestor(id, runningBranchStep, ancestorMap)) {
      continue;
    }
    state.conditionalSkips[id] = skipInfo;
    markSkipped(state, id);
    return false;
  }

  if (
    stepDeps.length > 0 &&
    stepDeps.every((d) => state.status[d] === "skipped")
  ) {
    markSkipped(state, id);
    return false;
  }

  return true;
}

// ── Step executors ─────────────────────────────────────────────────────────────

function executeTransform(step: WorkflowStep, state: ExecutionState): void {
  const config = step.config as TransformStep;
  const result = evaluateExpressionBlock(
    config.expression || "null",
    state.params,
    state.steps,
  );
  state.steps[step.id] = result;
  state.status[step.id] = "success";
  state.completed.push(step.id);
}

function executeConditional(step: WorkflowStep, state: ExecutionState): void {
  const config = step.config as ConditionalStep;
  let taken: boolean;
  try {
    taken = evaluateCondition(
      config.condition || "false",
      state.params,
      state.steps,
    );
  } catch {
    taken = false;
  }

  state.steps[step.id] = taken;
  state.status[step.id] = "success";

  if (taken) {
    if (config.elseStep) {
      state.skipStep = config.elseStep;
      state.conditionalSkips[config.elseStep] = {
        conditional: step.id,
        runningBranchStep: config.thenStep || null,
      };
    }
  } else if (config.thenStep) {
    state.skipStep = config.thenStep;
    state.conditionalSkips[config.thenStep] = {
      conditional: step.id,
      runningBranchStep: config.elseStep || null,
    };
  }

  state.completed.push(step.id);
}

async function executeElicitation(
  step: WorkflowStep,
  state: ExecutionState,
  server: WorkflowServer,
): Promise<WorkflowResult | null> {
  const config = step.config as ElicitationStep;
  if (!server.elicitInput) {
    throw new Error(
      `Step "${step.id}" requires elicitation but the server does not support it.`,
    );
  }
  const message = resolveTemplate(
    config.message || "",
    state.params,
    state.steps,
  );
  const result = await server.elicitInput({
    message,
    requestedSchema: config.requestedSchema,
  });

  if (result.action !== "accept") {
    if (config.onDecline === "abort") {
      return {
        status: "aborted",
        completedSteps: state.completed,
        stepResults: state.steps,
        error: `User declined at step "${step.label}"`,
      };
    }
    // skip_remaining (default): stop here, return what we have.
    markSkipped(state, step.id);
    return {
      status: "partial",
      completedSteps: state.completed,
      stepResults: state.steps,
    };
  }

  state.steps[step.id] = result.content ?? null;
  state.status[step.id] = "success";
  state.completed.push(step.id);
  return null;
}

// ── Orchestrator ────────────────────────────────────────────────────────────────

/** Validate step ids are unique and every dependsOn target exists. */
function validateGraph(workflow: WorkflowDefinition): void {
  const ids = new Set<string>();
  for (const step of workflow.steps) {
    if (ids.has(step.id)) {
      throw new Error(
        `Duplicate step id "${step.id}" in workflow "${workflow.name}".`,
      );
    }
    ids.add(step.id);
  }
  for (const step of workflow.steps) {
    for (const dep of step.dependsOn || []) {
      if (!ids.has(dep)) {
        throw new Error(
          `Step "${step.id}" depends on unknown step "${dep}" in workflow "${workflow.name}".`,
        );
      }
    }
  }
}

/** Execute a composed workflow against a client and MCP server. */
export async function runWorkflow(
  workflow: WorkflowDefinition,
  args: Record<string, unknown>,
  options: RunWorkflowOptions,
): Promise<WorkflowResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxForEach = options.maxForEachIterations ?? DEFAULT_MAX_FOREACH;
  const startTime = Date.now();

  const deps: Record<string, string[]> = Object.fromEntries(
    workflow.steps.map((s) => [s.id, s.dependsOn || []]),
  );
  const ancestorMap = buildAncestorMap(deps);
  const stepById = new Map(workflow.steps.map((s) => [s.id, s]));

  const state: ExecutionState = {
    params: args,
    steps: {},
    status: {},
    errors: {},
    completed: [],
    skipStep: null,
    conditionalSkips: {},
  };

  const runStep = async (
    step: WorkflowStep,
  ): Promise<WorkflowResult | null> => {
    switch (step.config.type) {
      case "api_call":
        await executeApiCall(
          step,
          state,
          options.client,
          options.endpoints,
          maxForEach,
        );
        return null;
      case "sampling":
        await executeSampling(step, state, options.server);
        return null;
      case "elicitation":
        return executeElicitation(step, state, options.server);
      case "transform":
        executeTransform(step, state);
        return null;
      case "conditional":
        executeConditional(step, state);
        return null;
      default:
        throw new Error(`Unknown step type for step "${step.id}".`);
    }
  };

  try {
    validateGraph(workflow);
    const remaining = new Set(workflow.steps.map((s) => s.id));

    while (remaining.size > 0) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(
          `Workflow "${workflow.name}" timed out after ${timeoutMs}ms ` +
            `(${state.completed.length}/${workflow.steps.length} steps done).`,
        );
      }
      if (options.signal?.aborted) {
        return {
          status: "aborted",
          completedSteps: state.completed,
          stepResults: state.steps,
          error: `Workflow "${workflow.name}" was aborted.`,
        };
      }
      if (state.skipStep && !remaining.has(state.skipStep)) {
        state.skipStep = null;
      }

      const ready: WorkflowStep[] = [];
      const skippedNow: string[] = [];
      for (const id of remaining) {
        const step = stepById.get(id)!;
        if (shouldRun(id, state, deps, ancestorMap)) ready.push(step);
        else if (state.status[id] === "skipped") skippedNow.push(id);
      }
      for (const id of skippedNow) remaining.delete(id);

      if (ready.length === 0) {
        if (skippedNow.length > 0) continue;
        // Deadlock guard: mark anything still pending as skipped and stop.
        for (const id of remaining) {
          if (!state.status[id]) markSkipped(state, id);
        }
        break;
      }

      // Conditional/elicitation steps run alone so branch decisions settle
      // before dependents are scheduled; everything else runs in parallel.
      const solo = ready.find(
        (s) =>
          s.config.type === "conditional" || s.config.type === "elicitation",
      );
      const batch = solo ? [solo] : ready;

      const settled = await Promise.allSettled(batch.map((s) => runStep(s)));
      for (let i = 0; i < settled.length; i++) {
        const step = batch[i];
        remaining.delete(step.id);
        const outcome = settled[i];
        if (outcome.status === "fulfilled") {
          if (outcome.value) return outcome.value;
        } else {
          const msg =
            outcome.reason instanceof Error
              ? outcome.reason.message
              : String(outcome.reason);
          throw new Error(`Step "${step.id}" failed: ${msg}`);
        }
      }
    }

    const hasStepErrors = Object.keys(state.errors).length > 0;
    return {
      status: hasStepErrors ? "partial" : "success",
      completedSteps: state.completed,
      stepResults: state.steps,
      ...(hasStepErrors ? { stepErrors: state.errors } : {}),
    };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      completedSteps: state.completed,
      stepResults: state.steps,
      ...(Object.keys(state.errors).length > 0
        ? { stepErrors: state.errors }
        : {}),
    };
  }
}
