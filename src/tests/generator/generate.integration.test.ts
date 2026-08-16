import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generateFromDsl } from "../../generator/pipeline.js";
import { runWorkflow } from "../../workflow/executor.js";
import type {
  EndpointInfo,
  WorkflowClient,
  WorkflowServer,
} from "../../workflow/executor.js";
import type { WorkflowDefinition } from "../../workflow/types.js";
import type {
  GetFullEndpointsResult,
  FullEndpoint,
} from "../../parser/types.js";
import { handleGenerate } from "../../tools/generate.js";

const DSL = `
PROJECT rocketchat_ops
DESCRIPTION Demo workflows for integration testing

WORKFLOW summarize_channel
  DESCRIPTION Fetch recent messages, summarize with AI, post the summary
  PARAM roomId : string : Target room id

  STEP fetch : api_call
    LABEL Fetch messages
    OPERATION channels.history
    MAP roomId = {{params.roomId}}
    MAP count = 20

  STEP summarize : sampling
    LABEL Summarize messages
    DEPENDS ON fetch
    PROMPT <<<
      Summarize these messages and respond with JSON: {{steps.fetch.messages}}
    >>>
    RESPONSE_FORMAT json

  STEP post : api_call
    LABEL Post the summary
    DEPENDS ON summarize
    OPERATION chat.postMessage
    MAP roomId = {{params.roomId}}
    MAP text = {{steps.summarize.summary}}
`;

const endpoints = [
  { operationId: "channels.history", method: "GET", path: "/api/v1/channels.history", summary: "Channel history" },
  { operationId: "chat.postMessage", method: "POST", path: "/api/v1/chat.postMessage", summary: "Post message" },
];

function fileMap(files: { path: string; content: string }[]): Map<string, string> {
  return new Map(files.map((f) => [f.path, f.content]));
}

/** Pull the embedded `const workflow: WorkflowDefinition = {...};` JSON back out. */
function extractWorkflow(toolSource: string): WorkflowDefinition {
  const marker = "const workflow: WorkflowDefinition = ";
  const start = toolSource.indexOf(marker) + marker.length;
  const end = toolSource.indexOf(";\n\nexport const tool", start);
  return JSON.parse(toolSource.slice(start, end)) as WorkflowDefinition;
}

describe("DSL -> generated MCP server", () => {
  const result = generateFromDsl(DSL, { endpoints });
  const files = fileMap(result.files);

  it("emits a complete, well-formed project file set", () => {
    for (const expected of [
      "package.json",
      "tsconfig.json",
      "README.md",
      ".env.example",
      ".gitignore",
      "src/server.ts",
      "src/rc-client.ts",
      "src/endpoints.ts",
      "src/engine/executor.ts",
      "src/engine/templates.ts",
      "src/engine/index.ts",
      "src/tools/summarize_channel.ts",
    ]) {
      assert.ok(files.has(expected), `missing generated file: ${expected}`);
    }
  });

  it("vendors the real engine source", () => {
    assert.match(files.get("src/engine/executor.ts")!, /export async function runWorkflow/);
    assert.match(files.get("src/engine/templates.ts")!, /validateSafeExpression/);
  });

  it("wires every workflow tool into the server entry", () => {
    const server = files.get("src/server.ts")!;
    assert.match(server, /from ".\/tools\/summarize_channel.js"/);
    assert.match(server, /server\.registerTool/);
    assert.match(server, /StdioServerTransport/);
  });

  it("produces a valid package.json with required deps", () => {
    const pkg = JSON.parse(files.get("package.json")!);
    assert.equal(pkg.name, "rocketchat_ops");
    assert.ok(pkg.dependencies["@modelcontextprotocol/sdk"]);
    assert.ok(pkg.dependencies.acorn, "engine needs acorn for expression validation");
    assert.ok(pkg.dependencies.zod);
  });

  it("records every referenced endpoint in the endpoint map", () => {
    const map = files.get("src/endpoints.ts")!;
    assert.match(map, /"channels.history"/);
    assert.match(map, /"chat.postMessage"/);
    assert.match(map, /\/api\/v1\/chat.postMessage/);
  });

  it("embeds a workflow that the engine can actually execute", async () => {
    const toolSource = files.get("src/tools/summarize_channel.ts")!;
    const workflow = extractWorkflow(toolSource);
    assert.equal(workflow.name, "summarize_channel");

    const calls: string[] = [];
    const client: WorkflowClient = {
      async request(method, path) {
        calls.push(`${method} ${path}`);
        return { ok: true, status: 200, data: { messages: [{ msg: "hello" }] } };
      },
    };
    const server: WorkflowServer = {
      async createMessage() {
        return { content: { type: "text", text: '{"summary":"all good"}' } };
      },
    };
    const endpointInfo: Record<string, EndpointInfo> = {
      "channels.history": { method: "GET", path: "/api/v1/channels.history" },
      "chat.postMessage": { method: "POST", path: "/api/v1/chat.postMessage" },
    };

    const run = await runWorkflow(workflow, { roomId: "room1" }, {
      client,
      server,
      endpoints: endpointInfo,
    });

    assert.equal(run.status, "success", JSON.stringify(run));
    assert.deepEqual(run.stepResults.summarize, { summary: "all good" });
    assert.ok(calls.some((c) => c.includes("chat.postMessage")));
  });
});

describe("generate tool writes a project to disk", () => {
  const outputDir = join(process.cwd(), ".tmp-generated-test");

  after(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  const stubParser = {
    async getFullEndpoints(): Promise<GetFullEndpointsResult> {
      return {
        endpoints: endpoints.map(
          (ep) =>
            ({
              operationId: ep.operationId,
              method: ep.method,
              path: ep.path,
              summary: ep.summary ?? "",
              description: "",
              domain: "messaging",
              parameters: [],
              security: [],
              inputSchema: { type: "object" },
              parameterSchemas: {},
            }) as unknown as FullEndpoint,
        ),
        correctedIds: new Map(),
      };
    },
  };

  it("resolves endpoints, generates, and writes files", async () => {
    const response = await handleGenerate(stubParser, { dsl: DSL, outputDir });
    assert.ok(!("isError" in response && response.isError), response.content[0].text);
    assert.match(response.content[0].text, /Generated MCP server "rocketchat_ops"/);

    const root = join(outputDir, "rocketchat_ops");
    assert.ok(existsSync(join(root, "src", "server.ts")));
    assert.ok(existsSync(join(root, "src", "tools", "summarize_channel.ts")));
    assert.ok(existsSync(join(root, "src", "engine", "executor.ts")));

    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.equal(pkg.name, "rocketchat_ops");
  });
});
