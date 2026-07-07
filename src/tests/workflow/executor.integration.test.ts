import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runWorkflow } from "../../workflow/executor.js";
import type {
  EndpointInfo,
  RunWorkflowOptions,
  WorkflowClient,
  WorkflowServer,
} from "../../workflow/executor.js";
import type { WorkflowDefinition, WorkflowStep } from "../../workflow/types.js";

const endpoints: Record<string, EndpointInfo> = {
  "channels.list": { method: "GET", path: "/api/v1/channels.list" },
  "chat.postMessage": { method: "POST", path: "/api/v1/chat.postMessage" },
};

function makeClient(
  handler: (
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ) => unknown,
): {
  client: WorkflowClient;
  calls: Array<{
    method: string;
    path: string;
    body?: Record<string, unknown>;
  }>;
} {
  const calls: Array<{
    method: string;
    path: string;
    body?: Record<string, unknown>;
  }> = [];
  const client: WorkflowClient = {
    async request(method, path, options) {
      calls.push({ method, path, body: options?.body });
      return {
        ok: true,
        status: 200,
        data: handler(method, path, options?.body),
      };
    },
  };
  return { client, calls };
}

const silentServer: WorkflowServer = {
  async createMessage() {
    return { content: { type: "text", text: "" } };
  },
};

function options(
  client: WorkflowClient,
  server: WorkflowServer = silentServer,
): RunWorkflowOptions {
  return { client, server, endpoints };
}

function workflow(steps: WorkflowStep[]): WorkflowDefinition {
  return {
    name: "test",
    description: "test workflow",
    params: { type: "object" },
    steps,
    requiredEndpoints: Object.keys(endpoints),
    usesSampling: false,
    usesElicitation: false,
  };
}

describe("runWorkflow", () => {
  it("runs a single api_call and stores its result", async () => {
    const { client, calls } = makeClient(() => ({ channels: [{ _id: "1" }] }));
    const result = await runWorkflow(
      workflow([
        {
          id: "list",
          label: "List channels",
          config: {
            type: "api_call",
            operationId: "channels.list",
            inputMapping: {},
          },
        },
      ]),
      {},
      options(client),
    );

    assert.equal(result.status, "success");
    assert.deepEqual(result.completedSteps, ["list"]);
    assert.deepEqual(result.stepResults.list, { channels: [{ _id: "1" }] });
    assert.equal(calls[0].method, "GET");
  });

  it("flows data between steps via templates", async () => {
    const { client, calls } = makeClient((_m, path, body) =>
      path.includes("channels.list")
        ? { channels: [{ _id: "room42" }] }
        : { ok: true, echoed: body },
    );

    const result = await runWorkflow(
      workflow([
        {
          id: "list",
          label: "List",
          config: {
            type: "api_call",
            operationId: "channels.list",
            inputMapping: {},
            outputPath: "channels",
          },
        },
        {
          id: "post",
          label: "Post",
          dependsOn: ["list"],
          config: {
            type: "api_call",
            operationId: "chat.postMessage",
            inputMapping: { roomId: "{{steps.list[0]._id}}", text: "hi" },
          },
        },
      ]),
      {},
      options(client),
    );

    assert.equal(result.status, "success");
    const postCall = calls.find((c) => c.path.includes("postMessage"))!;
    assert.equal(postCall.body?.roomId, "room42");
  });

  it("evaluates a transform step", async () => {
    const { client } = makeClient(() => ({ value: 10 }));
    const result = await runWorkflow(
      workflow([
        {
          id: "fetch",
          label: "Fetch",
          config: {
            type: "api_call",
            operationId: "channels.list",
            inputMapping: {},
          },
        },
        {
          id: "double",
          label: "Double",
          dependsOn: ["fetch"],
          config: { type: "transform", expression: "steps.fetch.value * 2" },
        },
      ]),
      {},
      options(client),
    );
    assert.equal(result.stepResults.double, 20);
  });

  it("skips the not-taken conditional branch", async () => {
    const { client } = makeClient(() => ({}));
    const def = workflow([
      {
        id: "cond",
        label: "Check",
        config: {
          type: "conditional",
          condition: "params.flag === true",
          thenStep: "yes",
          elseStep: "no",
        },
      },
      {
        id: "yes",
        label: "Yes branch",
        dependsOn: ["cond"],
        config: { type: "transform", expression: "'yes'" },
      },
      {
        id: "no",
        label: "No branch",
        dependsOn: ["cond"],
        config: { type: "transform", expression: "'no'" },
      },
    ]);

    const taken = await runWorkflow(def, { flag: true }, options(client));
    assert.equal(taken.stepResults.yes, "yes");
    assert.equal(taken.completedSteps.includes("no"), false);

    const notTaken = await runWorkflow(def, { flag: false }, options(client));
    assert.equal(notTaken.stepResults.no, "no");
    assert.equal(notTaken.completedSteps.includes("yes"), false);
  });

  it("fans out a forEach api_call", async () => {
    const { client, calls } = makeClient((_m, _p, body) => ({
      posted: body?.roomId,
    }));
    const result = await runWorkflow(
      workflow([
        {
          id: "post",
          label: "Post to each",
          config: {
            type: "api_call",
            operationId: "chat.postMessage",
            inputMapping: { roomId: "{{room}}" },
            forEach: "params.rooms",
            as: "room",
          },
        },
      ]),
      { rooms: ["r1", "r2", "r3"] },
      options(client),
    );

    assert.equal(result.status, "success");
    assert.equal((result.stepResults.post as unknown[]).length, 3);
    assert.equal(calls.length, 3);
  });

  it("parses JSON sampling output by intent", async () => {
    const server: WorkflowServer = {
      async createMessage() {
        return {
          content: { type: "text", text: 'Here you go: {"summary":"done"}' },
        };
      },
    };
    const { client } = makeClient(() => ({}));
    const result = await runWorkflow(
      workflow([
        {
          id: "sum",
          label: "Summarize",
          config: {
            type: "sampling",
            prompt: "Respond with a JSON object",
            responseFormat: "json",
          },
        },
      ]),
      {},
      { client, server, endpoints },
    );
    assert.deepEqual(result.stepResults.sum, { summary: "done" });
  });

  it("aborts on declined elicitation", async () => {
    const server: WorkflowServer = {
      async createMessage() {
        return { content: { type: "text", text: "" } };
      },
      async elicitInput() {
        return { action: "decline" };
      },
    };
    const { client } = makeClient(() => ({}));
    const result = await runWorkflow(
      workflow([
        {
          id: "ask",
          label: "Confirm",
          config: {
            type: "elicitation",
            message: "ok?",
            requestedSchema: { type: "object" },
            onDecline: "abort",
          },
        },
      ]),
      {},
      { client, server, endpoints },
    );
    assert.equal(result.status, "aborted");
  });

  it("reports an error result when a step fails", async () => {
    const client: WorkflowClient = {
      async request() {
        return { ok: false, status: 500, data: "boom" };
      },
    };
    const result = await runWorkflow(
      workflow([
        {
          id: "list",
          label: "List",
          config: {
            type: "api_call",
            operationId: "channels.list",
            inputMapping: {},
          },
        },
      ]),
      {},
      options(client),
    );
    assert.equal(result.status, "error");
    assert.match(result.error ?? "", /failed/);
  });

  it("rejects duplicate step ids", async () => {
    const { client } = makeClient(() => ({}));
    const result = await runWorkflow(
      workflow([
        { id: "x", label: "A", config: { type: "transform", expression: "1" } },
        { id: "x", label: "B", config: { type: "transform", expression: "2" } },
      ]),
      {},
      options(client),
    );
    assert.equal(result.status, "error");
    assert.match(result.error ?? "", /Duplicate step id/);
  });
});
