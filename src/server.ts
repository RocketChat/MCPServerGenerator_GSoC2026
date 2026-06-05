import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SpecParser } from "./parser/index.js";
import { handleGetCapabilityGuide } from "./tools/get-capability-guide.js";
import { handleGetEndpointSchemas } from "./tools/get-endpoint-schemas.js";

export function createMcpServer(parser?: SpecParser): {
  server: McpServer;
  parser: SpecParser;
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
        "Returns Rocket.Chat REST API operationIds grouped by domain. " +
        "Use this first to discover which endpoint schemas to inspect.",
      inputSchema: z.object({}).default({}),
    },
    async () => handleGetCapabilityGuide(resolvedParser),
  );

  server.registerTool(
    "get_endpoint_schemas",
    {
      description:
        "Returns request and response schemas for selected Rocket.Chat operationIds. " +
        "Use operationIds from get_capability_guide.",
      inputSchema: {
        operationIds: z.array(z.string()),
      },
    },
    async ({ operationIds }) =>
      handleGetEndpointSchemas(resolvedParser, operationIds),
  );

  return { server, parser: resolvedParser };
}
