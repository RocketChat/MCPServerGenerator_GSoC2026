import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runWorkflow } from "../../workflow/executor.js";
import type {
  EndpointInfo,
  WorkflowClient,
  WorkflowServer,
} from "../../workflow/executor.js";
import type { WorkflowDefinition } from "../../workflow/types.js";

/**
 * An api_call step whose operationId is absent from the endpoint map must fail
 * loudly instead of silently issuing a request to an empty `GET` path.
 */
const workflow: WorkflowDefinition = {
  name: "wf",
  description: "d",
  params: { type: "object", properties: {} },
  steps: [
    {
      id: "call",
      label: "call",
      config: { type: "api_call", operationId: "missing.op", inputMapping: {} },
    },
  ],
  requiredEndpoints: ["missing.op"],
  usesSampling: false,
  usesElicitation: false,
};

describe("api_call with an unregistered operationId fails closed at runtime", () => {
  it("errors out and never issues a request", async () => {
    let requestCount = 0;
    const client: WorkflowClient = {
      async request() {
        requestCount++;
        return { ok: true, status: 200, data: {} };
      },
    };
    const server: WorkflowServer = {
      async createMessage() {
        return { content: { type: "text", text: "" } };
      },
    };
    const endpoints: Record<string, EndpointInfo> = {};

    const run = await runWorkflow(workflow, {}, { client, server, endpoints });

    assert.equal(run.status, "error");
    assert.match(run.error ?? "", /No endpoint registered for operationId/);
    assert.equal(requestCount, 0, "no HTTP request should be made");
  });
});
