import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SpecParser } from "./parser/index.js";
import { handleGetCapabilityGuide } from "./tools/get-capability-guide.js";
import { handleGetEndpointSchemas } from "./tools/get-endpoint-schemas.js";

const server = new McpServer({
  name: "mcp-server-generator",
  version: "0.1.0",
});

const parser = new SpecParser();

server.registerTool(
  "get_capability_guide",
  {
    description:
      "Returns Rocket.Chat REST API operationIds grouped by domain. " +
      "Use this first to discover which endpoint schemas to inspect.",
    inputSchema: {},
  },
  async () => handleGetCapabilityGuide(parser),
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
  async ({ operationIds }) => handleGetEndpointSchemas(parser, operationIds),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});
