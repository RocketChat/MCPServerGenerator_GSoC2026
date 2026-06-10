import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SpecParser } from "./parser/index.js";
import type { SpecParserInterface } from "./parser/index.js";
import { handleGetCapabilityGuide } from "./tools/get-capability-guide.js";
import { handleGetEndpointSchemas } from "./tools/get-endpoint-schemas.js";

export function createMcpServer(parser?: SpecParserInterface): {
  server: McpServer;
  parser: SpecParserInterface;
} {
  const resolvedParser = parser ?? new SpecParser();

  const server = new McpServer({
    name: "mcp-server-generator",
    version: "0.1.0",
  });

  server.registerTool(
    "get_capability_guide",
    {
      description:
        "Returns ALL Rocket.Chat API endpoints (with operationIds) in one guide. " +
        "This is the discovery tool — call it FIRST. " +
        "API entries show 'summary → operationId' — use operationIds in workflow steps. " +
        "After picking ALL needed operationIds, call get_endpoint_schemas ONCE with ALL of them in a single call BEFORE writing workflows.",
    },
    async () => handleGetCapabilityGuide(resolvedParser),
  );

  server.registerTool(
    "get_endpoint_schemas",
    {
      description:
        "Get exact request/response schemas for chosen operationIds. " +
        "Call this AFTER get_capability_guide, BEFORE writing your DSL for generate. " +
        "IMPORTANT: Pass ALL operationIds you need in a SINGLE call — do NOT split across multiple calls. There is no limit on array size. " +
        "Returns request body schemas (exact field names for inputMapping) and response shape summaries (for {{steps.X.result.Y}} references). " +
        "If you need both channels_* and groups_* variants, request both explicitly.",
      inputSchema: {
        operationIds: z.array(z.string()),
      },
      outputSchema: {
        endpoints: z.record(z.string(), z.record(z.string(), z.unknown())),
        correctedOperationIds: z.record(z.string(), z.string()).optional(),
        unmatchedOperationIds: z.array(z.string()).optional(),
      },
    },
    async ({ operationIds }) =>
      handleGetEndpointSchemas(resolvedParser, operationIds),
  );

  return { server, parser: resolvedParser };
}
