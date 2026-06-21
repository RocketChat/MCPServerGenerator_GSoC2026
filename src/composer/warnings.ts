import type { JSONSchema7 } from "json-schema";
import type {
  ApiCallStep,
  ConditionalStep,
  SamplingStep,
} from "../workflow/types.js";
import { ComposerError, type ComposerWarning, type ComposeStepInput } from "./types.js";
import { extractStepRefs, findLiteralRid } from "./utils.js";

export function generateSemanticWarnings(
  steps: ComposeStepInput[],
  params?: JSONSchema7,
): ComposerWarning[] {
  const warnings: ComposerWarning[] = [];
  const stepIds = new Set(steps.map((s) => s.id));
  const hasParams =
    params &&
    Object.keys((params.properties as Record<string, unknown>) ?? {}).length >
    0;

  const referencedSteps = new Set<string>();
  for (const step of steps) {
    for (const dep of step.dependsOn ?? []) referencedSteps.add(dep);
    const refs = extractStepRefs(step.config);
    for (const r of refs) referencedSteps.add(r);
    if (step.config.type === "conditional") {
      const cfg = step.config as ConditionalStep;
      referencedSteps.add(cfg.thenStep);
      if (cfg.elseStep) referencedSteps.add(cfg.elseStep);
    }
  }

  for (const step of steps) {
    if (step.config.type === "sampling") {
      let referenced = false;
      for (const other of steps) {
        if (other.id === step.id) continue;
        const refs = extractStepRefs(other.config);
        if (refs.has(step.id)) {
          referenced = true;
          break;
        }
      }
      if (!referenced) {
        warnings.push({
          stepId: step.id,
          code: "UNUSED_SAMPLING",
          message: `Sampling step "${step.id}" result is never referenced by any other step. This wastes an LLM call.`,
        });
      }

      const cfg = step.config as SamplingStep;
      const allText = [
        cfg.prompt ?? "",
        cfg.systemPrompt ?? "",
        ...(cfg.content ?? []).map((c) =>
          c.type === "text" ? (c.text ?? "") : (c.url ?? ""),
        ),
      ].join(" ");
      const hasTemplateRef = /\{\{(params|steps)\./.test(allText);
      if (!hasTemplateRef && hasParams) {
        throw new ComposerError(
          `Sampling step "${step.id}" prompt does not reference any {{params.*}} or {{steps.*}} data. ` +
          `The AI will have no input to analyze. Include the relevant data in the prompt ` +
          `(e.g. {{params.message.text}}).`,
        );
      }
    }
  }

  const forward = new Map<string, Set<string>>();
  for (const step of steps) {
    if (!forward.has(step.id)) forward.set(step.id, new Set());
    for (const dep of step.dependsOn ?? []) {
      if (!forward.has(dep)) forward.set(dep, new Set());
      forward.get(dep)!.add(step.id);
    }
    if (step.config.type === "conditional") {
      const cfg = step.config as ConditionalStep;
      forward.get(step.id)!.add(cfg.thenStep);
      if (cfg.elseStep) forward.get(step.id)!.add(cfg.elseStep);
    }
  }

  const reachable = new Set<string>();
  const queue: string[] = [];
  for (const step of steps) {
    if (!step.dependsOn || step.dependsOn.length === 0) {
      reachable.add(step.id);
      queue.push(step.id);
    }
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const next of forward.get(id) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }

  for (const step of steps) {
    if (!reachable.has(step.id)) {
      warnings.push({
        stepId: step.id,
        code: "ORPHANED_STEP",
        message: `Step "${step.id}" is not reachable from any entry point. It will never execute.`,
      });
    }
  }

  const rootSteps = steps.filter(
    (s) => !s.dependsOn || s.dependsOn.length === 0,
  );
  if (rootSteps.length > 1) {
    const rootIds = rootSteps.map((s) => s.id);
    warnings.push({
      stepId: null,
      code: "MULTIPLE_ROOTS",
      message:
        `Workflow has ${rootSteps.length} root steps (no dependsOn): [${rootIds.join(", ")}]. ` +
        `Most workflows should have exactly 1 entry point. ` +
        `If these steps should run after other steps, add them to dependsOn.`,
    });
  }

  const opCounts = new Map<string, string[]>();
  for (const step of steps) {
    if (step.config.type === "api_call") {
      const opId = (step.config as ApiCallStep).operationId;
      const list = opCounts.get(opId) ?? [];
      list.push(step.id);
      opCounts.set(opId, list);
    }
  }
  for (const [opId, stepIds] of opCounts) {
    if (stepIds.length > 1) {
      warnings.push({
        stepId: null,
        code: "DUPLICATE_API_CALL",
        message: `Multiple steps (${stepIds.join(", ")}) call the same endpoint "${opId}". Is this intentional?`,
      });
    }
  }

  for (const step of steps) {
    if (step.config.type !== "api_call") continue;
    const cfg = step.config as ApiCallStep;
    if (
      !cfg.operationId.includes("chat_sendMessage") &&
      !cfg.operationId.includes("chat.sendMessage")
    )
      continue;
    const rid = findLiteralRid(cfg.inputMapping);
    if (rid) {
      warnings.push({
        stepId: step.id,
        code: "HARDCODED_RID",
        message:
          `Step "${step.id}" uses chat.sendMessage with hardcoded rid "${rid}". ` +
          `The rid field requires a room ID (e.g. "6oaKzj..."), not a channel name. ` +
          `Use "post-api-v1-chat-postMessage" with { channel: "#${rid}", text: "..." } instead, ` +
          `which resolves channel names natively.`,
      });
    }
  }

  const depthCache = new Map<string, number>();
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  function getDepth(id: string): number {
    if (depthCache.has(id)) return depthCache.get(id)!;
    const step = stepMap.get(id);
    if (!step || !step.dependsOn || step.dependsOn.length === 0) {
      depthCache.set(id, 0);
      return 0;
    }
    const maxParent = Math.max(...step.dependsOn.map(getDepth));
    const depth = maxParent + 1;
    depthCache.set(id, depth);
    return depth;
  }
  for (const step of steps) {
    const depth = getDepth(step.id);
    if (depth > 8) {
      warnings.push({
        stepId: step.id,
        code: "DEEP_CHAIN",
        message: `Step "${step.id}" is ${depth} levels deep in the dependency chain. Consider simplifying.`,
      });
      break;
    }
  }

  return warnings;
}

