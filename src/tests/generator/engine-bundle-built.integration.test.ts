import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Smoke test proving `generate` works from the BUILT package, not just from
 * source. `engine-bundle` reads the engine `.ts` sources at runtime; `tsc`
 * emits only `.js`, so this exercises the build's engine-source copy step and
 * the built module's path resolution end to end.
 */

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const DSL = `
PROJECT built_smoke
DESCRIPTION built package smoke test

WORKFLOW w
  DESCRIPTION single sampling step
  STEP think : sampling
    PROMPT hello
`;

const endpoints = [
  {
    operationId: "chat.postMessage",
    method: "POST",
    path: "/api/v1/chat.postMessage",
  },
];

describe("generate works from the built dist package", () => {
  before(() => {
    const build = spawnSync("npm run build", {
      cwd: repoRoot,
      shell: true,
      encoding: "utf8",
    });
    assert.equal(
      build.status,
      0,
      `build failed:\n${build.stdout}\n${build.stderr}`,
    );
  });

  it("copies engine sources next to the compiled output", () => {
    assert.ok(
      existsSync(join(repoRoot, "dist", "workflow", "executor.ts")),
      "dist/workflow/executor.ts should exist after build",
    );
  });

  it("bundles a real, non-empty engine from the built generator", async () => {
    const builtPipeline = pathToFileURL(
      join(repoRoot, "dist", "generator", "index.js"),
    ).href;
    const { generateFromDsl } = await import(builtPipeline);

    const result = generateFromDsl(DSL, { endpoints });
    const files = new Map<string, string>(
      result.files.map((f: { path: string; content: string }) => [
        f.path,
        f.content,
      ]),
    );

    const executor = files.get("src/engine/executor.ts");
    assert.ok(
      executor && executor.length > 0,
      "engine executor must be bundled",
    );
    assert.match(executor!, /export async function runWorkflow/);
  });
});
