import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../server.js";
import type { SpecParser } from "../../parser/index.js";
import type { Domain } from "../../parser/types.js";

const operationId = "post-api-v1-chat_postMessage";

const mockParser = {
  getAvailableDomains: () => ["messaging" as Domain],
  listEndpoints: async () => [
    {
      operationId,
      summary: "Post Message",
      domain: "messaging" as Domain,
    },
  ],
  getFullEndpoints: async () => ({
    endpoints: [
      {
        operationId,
        method: "POST",
        path: "/api/v1/chat.postMessage",
        summary: "Post Message",
        description: "Post Message",
        domain: "messaging" as Domain,
        parameters: [],
        security: [],
        inputSchema: {
          type: "object",
          properties: {
            requestBody: {
              type: "object",
              properties: {
                text: { type: "string" },
              },
            },
          },
        },
      },
    ],
    correctedIds: new Map<string, string>(),
  }),
} as unknown as SpecParser;

async function connectTestClient() {
  const { server } = createMcpServer(mockParser);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, server };
}

function assertTextContent(
  result: Awaited<ReturnType<Client["callTool"]>>,
): string {
  assert.ok("content" in result);
  assert.ok(Array.isArray(result.content));
  assert.equal(result.content[0]?.type, "text");
  return result.content[0].text;
}

describe("MCP protocol smoke test", () => {
  it("lists all registered tools via protocol", async () => {
    const { client, server } = await connectTestClient();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name);

      assert.ok(names.includes("get_capability_guide"));
      assert.ok(names.includes("get_endpoint_schemas"));
      assert.equal(tools.length, 2);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("calls get_capability_guide and returns text content", async () => {
    const { client, server } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: "get_capability_guide",
        arguments: {},
      });
      assert.ok("isError" in result ? !result.isError : true);

      const text = assertTextContent(result);
      assert.ok(text.includes(operationId));
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("calls get_capability_guide without arguments", async () => {
    const { client, server } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: "get_capability_guide",
      } as any);
      assert.ok("isError" in result ? !result.isError : true);

      const text = assertTextContent(result);
      assert.ok(text.includes(operationId));
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("calls get_endpoint_schemas and returns JSON content", async () => {
    const { client, server } = await connectTestClient();
    try {
      const result = await client.callTool({
        name: "get_endpoint_schemas",
        arguments: { operationIds: [operationId] },
      });
      assert.ok("isError" in result ? !result.isError : true);

      const text = assertTextContent(result);
      const json = JSON.parse(text);
      assert.ok(json.endpoints[operationId]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
