import { bundleEngine } from "./engine-bundle.js";
import {
  generateEndpointMap,
  generateServerEntry,
  generateTestSetup,
  generateToolFile,
  generateToolTest,
} from "./codegen.js";
import {
  generateEnvExample,
  generateGitignore,
  generatePackageJson,
  generateReadme,
  generateRcClient,
  generateTsConfig,
} from "./scaffold.js";
import type {
  GeneratedFile,
  GenerateProjectInput,
  GenerateProjectResult,
} from "./types.js";

/** Normalize an arbitrary name into a valid lowercase package/server name. */
export function sanitizeServerName(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safe = /^[a-z]/.test(cleaned) ? cleaned : `mcp_${cleaned}`;
  return safe || "mcp_server";
}

/** Assemble the full set of files for a generated MCP server project. */
export function generateProject(
  input: GenerateProjectInput,
): GenerateProjectResult {
  const serverName = sanitizeServerName(input.serverName);
  const { workflows, endpoints } = input;

  if (workflows.length === 0) {
    throw new Error("Cannot generate a project with no workflows.");
  }

  const usesSampling = workflows.some((w) => w.usesSampling);
  const usesElicitation = workflows.some((w) => w.usesElicitation);

  const files: GeneratedFile[] = [];

  // Vendored engine.
  files.push(...bundleEngine());

  // One tool file + one test file per workflow.
  for (const workflow of workflows) {
    files.push({
      path: `src/tools/${workflow.name}.ts`,
      content: generateToolFile(workflow),
    });
    files.push({
      path: `src/tests/${workflow.name}.test.ts`,
      content: generateToolTest(workflow),
    });
  }

  // Shared test setup (mock client/server/endpoints).
  files.push({ path: "src/tests/setup.ts", content: generateTestSetup() });

  // Wiring + scaffolding.
  files.push({
    path: "src/endpoints.ts",
    content: generateEndpointMap(endpoints),
  });
  files.push({ path: "src/rc-client.ts", content: generateRcClient() });
  files.push({
    path: "src/server.ts",
    content: generateServerEntry(serverName, workflows),
  });
  files.push({
    path: "package.json",
    content: generatePackageJson(serverName),
  });
  files.push({ path: "tsconfig.json", content: generateTsConfig() });
  files.push({ path: ".gitignore", content: generateGitignore() });
  files.push({
    path: ".env.example",
    content: generateEnvExample(usesSampling),
  });
  files.push({
    path: "README.md",
    content: generateReadme(serverName, workflows, endpoints),
  });

  return {
    files,
    summary: {
      serverName,
      workflowCount: workflows.length,
      endpointCount: endpoints.length,
      usesSampling,
      usesElicitation,
    },
  };
}
