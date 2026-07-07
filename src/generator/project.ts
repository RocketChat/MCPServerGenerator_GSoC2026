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
import type { WorkflowDefinition } from "../workflow/types.js";

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

/**
 * Reduce a workflow name to a safe module basename for `src/tools/<name>.ts`.
 * The result only contains `[A-Za-z0-9_]` and always starts with a letter or
 * underscore, so it is safe both as a filename and when embedded in an import
 * specifier — a workflow name is otherwise unconstrained DSL text.
 */
export function sanitizeModuleName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (cleaned === "") return "tool";
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `tool_${cleaned}`;
}

/**
 * Assign a unique module basename to each workflow (aligned by index),
 * disambiguating collisions produced by sanitization with a numeric suffix.
 */
export function assignModuleNames(workflows: WorkflowDefinition[]): string[] {
  const used = new Set<string>();
  return workflows.map((workflow) => {
    const base = sanitizeModuleName(workflow.name);
    let candidate = base;
    let counter = 2;
    while (used.has(candidate)) {
      candidate = `${base}_${counter++}`;
    }
    used.add(candidate);
    return candidate;
  });
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

  // One tool file + one test file per workflow, keyed by a safe, unique module
  // basename so an arbitrary workflow name can never break the filename or its
  // import.
  const moduleNames = assignModuleNames(workflows);
  workflows.forEach((workflow, i) => {
    files.push({
      path: `src/tools/${moduleNames[i]}.ts`,
      content: generateToolFile(workflow),
    });
    files.push({
      path: `src/tests/${moduleNames[i]}.test.ts`,
      content: generateToolTest(workflow, moduleNames[i]),
    });
  });

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
    content: generateServerEntry(serverName, workflows, moduleNames),
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
