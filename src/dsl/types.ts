export interface ParseDslResult {
  projectName: string;
  description: string;
  workflows: DslWorkflow[];
  webhookEndpoints?: DslWebhook[];
}

export interface DslWorkflowParams {
  type: "object";
  properties: Record<string, { type: string; description?: string }>;
}

export interface DslWorkflow {
  name: string;
  description: string;
  params?: DslWorkflowParams;
  steps: DslStep[];
}

export interface DslStep {
  id: string;
  label?: string;
  type: string;
  dependsOn?: string[];
  operationId?: string;
  inputMapping?: Record<string, unknown>;
  outputPath?: string;
  forEach?: string;
  as?: string;
  prompt?: string;
  systemPrompt?: string;
  maxTokens?: number;
  responseFormat?: string;
  content?: Array<
    { type: "text"; text: string } | { type: "image"; url: string }
  >;
  expression?: string;
  condition?: string;
  thenStep?: string;
  elseStep?: string;
  message?: string;
  requestedSchema?: Record<string, unknown>;
  onDecline?: "abort" | "skip_remaining";
  continueOnError?: boolean;
}

export interface DslWebhook {
  path: string;
  description: string;
  methods: ("get" | "post")[];
}

export class DslParseError extends Error {
  public readonly line: number;

  constructor(line: number, message: string) {
    super(`Line ${line}: ${message}`);
    this.name = "DslParseError";
    this.line = line;
  }
}
