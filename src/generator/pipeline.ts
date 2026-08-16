import { composeWorkflowDefinition } from "../composer/index.js";
import type { ComposerWarning } from "../composer/types.js";
import { parseDsl } from "../dsl/index.js";
import type { WorkflowDefinition } from "../workflow/types.js";
import { dslWorkflowToComposeInput } from "./dsl-mapping.js";
import { generateProject } from "./project.js";
import type { GeneratorEndpoint, GenerateProjectResult } from "./types.js";

export interface ComposeDslResult {
  projectName: string;
  description: string;
  workflows: WorkflowDefinition[];
  warnings: ComposerWarning[];
}

/** Parse a DSL document and compose every workflow it declares. */
export function composeDsl(dsl: string): ComposeDslResult {
  const parsed = parseDsl(dsl);
  const workflows: WorkflowDefinition[] = [];
  const warnings: ComposerWarning[] = [];

  for (const wf of parsed.workflows) {
    const result = composeWorkflowDefinition(dslWorkflowToComposeInput(wf));
    workflows.push(result.workflow);
    warnings.push(...result.warnings);
  }

  return {
    projectName: parsed.projectName,
    description: parsed.description,
    workflows,
    warnings,
  };
}

export interface GenerateFromDslOptions {
  /** Endpoint registry for every operationId the workflows call. */
  endpoints: GeneratorEndpoint[];
  /** Override the server name (defaults to the DSL PROJECT name). */
  serverName?: string;
}

export interface GenerateFromDslResult extends GenerateProjectResult {
  warnings: ComposerWarning[];
}

/** Full pipeline: DSL text -> parsed -> composed -> generated project files. */
export function generateFromDsl(
  dsl: string,
  options: GenerateFromDslOptions,
): GenerateFromDslResult {
  const composed = composeDsl(dsl);
  const result = generateProject({
    serverName: options.serverName ?? composed.projectName,
    workflows: composed.workflows,
    endpoints: options.endpoints,
  });
  return { ...result, warnings: composed.warnings };
}
