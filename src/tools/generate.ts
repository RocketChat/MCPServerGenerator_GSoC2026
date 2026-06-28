import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EndpointDetailSource } from "../parser/types.js";
import { composeDsl } from "../generator/pipeline.js";
import { generateProject, sanitizeServerName } from "../generator/project.js";
import type { GeneratorEndpoint } from "../generator/types.js";

export interface GenerateArgs {
  /** The workflow DSL document. */
  dsl: string;
  /** Directory to write the generated project into. Default: "./generated". */
  outputDir?: string;
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function fail(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

/**
 * Generate a complete MCP server project from a DSL document and write it to
 * disk. Resolves the API endpoints the workflows reference through the parser,
 * so the generated endpoint map carries real methods and paths.
 */
export async function handleGenerate(
  parser: EndpointDetailSource,
  args: GenerateArgs,
) {
  let composed;
  try {
    composed = composeDsl(args.dsl);
  } catch (err) {
    return fail(`DSL error: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (composed.workflows.length === 0) {
    return fail("The DSL declared no workflows.");
  }

  const operationIds = [
    ...new Set(composed.workflows.flatMap((w) => w.requiredEndpoints)),
  ].filter(Boolean);

  let endpoints: GeneratorEndpoint[] = [];
  try {
    const resolved = await parser.getFullEndpoints(operationIds);
    endpoints = resolved.endpoints.map((ep) => ({
      operationId: ep.operationId,
      method: ep.method,
      path: ep.path,
      summary: ep.summary,
    }));
  } catch (err) {
    return fail(
      `Failed to resolve endpoints: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const missing = operationIds.filter(
    (id) => !endpoints.some((ep) => ep.operationId === id),
  );

  let result;
  try {
    result = generateProject({
      serverName: composed.projectName,
      workflows: composed.workflows,
      endpoints,
    });
  } catch (err) {
    return fail(
      `Generation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const root = join(args.outputDir ?? "generated", result.summary.serverName);
  try {
    for (const file of result.files) {
      const target = join(root, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content, "utf8");
    }
  } catch (err) {
    return fail(
      `Failed to write project: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const lines = [
    `Generated MCP server "${result.summary.serverName}" at ${root}`,
    `  Workflows: ${result.summary.workflowCount}`,
    `  Endpoints: ${result.summary.endpointCount}`,
    `  Files: ${result.files.length}`,
    `  Sampling: ${result.summary.usesSampling ? "yes" : "no"}, Elicitation: ${
      result.summary.usesElicitation ? "yes" : "no"
    }`,
  ];
  if (missing.length > 0) {
    lines.push(`  Unresolved operationIds (verify these): ${missing.join(", ")}`);
  }
  if (composed.warnings.length > 0) {
    lines.push(`  Composer notes (${composed.warnings.length}) — informational:`);
    for (const w of composed.warnings.slice(0, 10)) {
      lines.push(`    - [${w.code}] ${w.message}`);
    }
  }

  return ok(lines.join("\n"));
}

export { sanitizeServerName };
