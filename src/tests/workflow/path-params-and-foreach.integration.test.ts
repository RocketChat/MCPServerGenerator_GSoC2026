import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runWorkflow } from "../../workflow/executor.js";
import type {
  ApiResponse,
  EndpointInfo,
  RunWorkflowOptions,
  WorkflowClient,
  WorkflowServer,
} from "../../workflow/executor.js";
import type { WorkflowDefinition, WorkflowStep } from "../../workflow/types.js";

const endpoints: Record<string, EndpointInfo> = {
  // Path-parameter endpoints (the case Rocket.Chat uses heavily).
  "apps.info": { method: "GET", path: "/api/apps/public/{app-id}/info" },
  "apps.incoming": {
    method: "POST",
    path: "/api/apps/public/{app-id}/incoming",
  },
  // Plain endpoint for forEach fan-out.
  "channels.archive": { method: "POST", path: "/api/v1/channels.archive" },
};

interface Call {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

function makeClient(handler: (call: Call) => ApiResponse): {
  client: WorkflowClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  const client: WorkflowClient = {
    async request(method, path, options) {
      const call: Call = { method, path, body: options?.body };
      calls.push(call);
      return handler(call);
    },
  };
  return { client, calls };
}

const silentServer: WorkflowServer = {
  async createMessage() {
    return { content: { type: "text", text: "" } };
  },
};

function options(client: WorkflowClient): RunWorkflowOptions {
  return { client, server: silentServer, endpoints };
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

const ok = (data: unknown): ApiResponse => ({ ok: true, status: 200, data });

describe("path parameter substitution", () => {
  it("substitutes {param} into a GET path and drops it from the query string", async () => {
    const { client, calls } = makeClient(() => ok({ name: "my-app" }));
    const result = await runWorkflow(
      workflow([
        {
          id: "info",
          label: "App info",
          config: {
            type: "api_call",
            operationId: "apps.info",
            inputMapping: { "app-id": "{{params.appId}}", lang: "en" },
          },
        },
      ]),
      { appId: "abc123" },
      options(client),
    );

    assert.equal(result.status, "success");
    // Placeholder is gone, value is substituted...
    assert.equal(calls[0].path, "/api/apps/public/abc123/info?lang=en");
    assert.ok(!calls[0].path.includes("{app-id}"));
    // ...and the path param is NOT duplicated as a query field.
    assert.ok(!calls[0].path.includes("app-id="));
  });

  it("substitutes {param} into a POST path without sending it in the body", async () => {
    const { client, calls } = makeClient(() => ok({ ok: true }));
    const result = await runWorkflow(
      workflow([
        {
          id: "send",
          label: "Send incoming",
          config: {
            type: "api_call",
            operationId: "apps.incoming",
            inputMapping: { "app-id": "{{params.appId}}", text: "hello" },
          },
        },
      ]),
      { appId: "APP42" },
      options(client),
    );

    assert.equal(result.status, "success");
    assert.equal(calls[0].path, "/api/apps/public/APP42/incoming");
    assert.deepEqual(calls[0].body, { text: "hello" });
    assert.ok(!("app-id" in (calls[0].body ?? {})));
  });

  it("URL-encodes path parameter values", async () => {
    const { client, calls } = makeClient(() => ok({}));
    await runWorkflow(
      workflow([
        {
          id: "info",
          label: "App info",
          config: {
            type: "api_call",
            operationId: "apps.info",
            inputMapping: { "app-id": "{{params.appId}}" },
          },
        },
      ]),
      { appId: "a/b c" },
      options(client),
    );
    assert.equal(calls[0].path, "/api/apps/public/a%2Fb%20c/info");
  });

  it("errors when a required path parameter is missing", async () => {
    const { client } = makeClient(() => ok({}));
    const result = await runWorkflow(
      workflow([
        {
          id: "send",
          label: "Send incoming",
          config: {
            type: "api_call",
            operationId: "apps.incoming",
            inputMapping: { "app-id": "{{params.doesNotExist}}", text: "hi" },
          },
        },
      ]),
      {},
      options(client),
    );

    assert.equal(result.status, "error");
    assert.match(
      result.error ?? "",
      /missing required path parameter "app-id"/,
    );
  });
});

describe("forEach failure policy", () => {
  const archiveSteps = (continueOnError?: boolean): WorkflowStep[] => [
    {
      id: "archive",
      label: "Archive each room",
      config: {
        type: "api_call",
        operationId: "channels.archive",
        inputMapping: { roomId: "{{room}}" },
        forEach: "params.rooms",
        as: "room",
        ...(continueOnError !== undefined ? { continueOnError } : {}),
      },
    },
  ];

  // A client that fails only for room "r2".
  const partialClient = () =>
    makeClient((call): ApiResponse => {
      if (call.body?.roomId === "r2") {
        return { ok: false, status: 500, data: "boom" };
      }
      return ok({ archived: call.body?.roomId });
    });

  it("fails the whole step by default when any iteration fails", async () => {
    const { client } = partialClient();
    const result = await runWorkflow(
      workflow(archiveSteps()),
      { rooms: ["r1", "r2", "r3"] },
      options(client),
    );

    assert.equal(result.status, "error");
    assert.match(result.error ?? "", /failed iteration/);
    // The failed step is not reported as completed.
    assert.ok(!result.completedSteps.includes("archive"));
  });

  it("continues and reports partial success when continueOnError is set", async () => {
    const { client, calls } = partialClient();
    const result = await runWorkflow(
      workflow(archiveSteps(true)),
      { rooms: ["r1", "r2", "r3"] },
      options(client),
    );

    // All iterations were attempted.
    assert.equal(calls.length, 3);
    // Overall status is explicitly partial, with per-step error detail.
    assert.equal(result.status, "partial");
    assert.match(
      result.stepErrors?.archive ?? "",
      /1\/3 iteration\(s\) failed/,
    );

    const results = result.stepResults.archive as unknown[];
    assert.equal(results.length, 3);
    assert.deepEqual(results[0], { archived: "r1" });
    assert.equal(results[1], null); // failed item is an explicit null
    assert.deepEqual(results[2], { archived: "r3" });
  });

  it("reports plain success when every iteration succeeds", async () => {
    const { client } = makeClient((call) =>
      ok({ archived: call.body?.roomId }),
    );
    const result = await runWorkflow(
      workflow(archiveSteps(true)),
      { rooms: ["r1", "r2"] },
      options(client),
    );

    assert.equal(result.status, "success");
    assert.equal(result.stepErrors, undefined);
    assert.equal((result.stepResults.archive as unknown[]).length, 2);
  });
});
