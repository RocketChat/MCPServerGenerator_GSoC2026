import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GeneratedFile } from "./types.js";

/**
 * Runtime engine modules vendored verbatim into every generated project. These
 * are the actual source files from `src/workflow/` — copied, never re-authored —
 * so a generated server runs the exact engine this package ships and tests.
 *
 * `index.ts` and `types.ts` from the workflow folder are intentionally excluded:
 * the workflow barrel re-exports the composer (compile-time only), so the
 * generated project gets a slim engine barrel instead (see ENGINE_INDEX).
 */
const ENGINE_MODULES = [
  "types.ts",
  "expression-security.ts",
  "templates.ts",
  "api-call.ts",
  "sampling.ts",
  "executor.ts",
] as const;

const ENGINE_INDEX = `export * from "./types.js";
export * from "./expression-security.js";
export * from "./templates.js";
export * from "./api-call.js";
export * from "./sampling.js";
export * from "./executor.js";
`;

/** Locate this package's `src/workflow` directory relative to this module. */
function workflowDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "workflow");
}

/**
 * Read the engine source files and return them as generated files under
 * `src/engine/`, plus a slim barrel.
 */
export function bundleEngine(): GeneratedFile[] {
  const dir = workflowDir();
  const files: GeneratedFile[] = ENGINE_MODULES.map((name) => ({
    path: `src/engine/${name}`,
    content: readFileSync(join(dir, name), "utf8"),
  }));
  files.push({ path: "src/engine/index.ts", content: ENGINE_INDEX });
  return files;
}
