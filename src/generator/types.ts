import type { WorkflowDefinition } from "../workflow/types.js";

/** A single file in a generated project, with a project-relative POSIX path. */
export interface GeneratedFile {
  path: string;
  content: string;
}

/** Minimal endpoint record the generator needs to build the endpoint map. */
export interface GeneratorEndpoint {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
}

export interface GenerateProjectInput {
  /** Lowercase project/server name (e.g. "rocketchat_ops"). */
  serverName: string;
  workflows: WorkflowDefinition[];
  endpoints: GeneratorEndpoint[];
}

/** Result of generating a project: the file set plus a short summary. */
export interface GenerateProjectResult {
  files: GeneratedFile[];
  summary: {
    serverName: string;
    workflowCount: number;
    endpointCount: number;
    usesSampling: boolean;
    usesElicitation: boolean;
  };
}
