/**
 * Post-build step: copy the workflow engine `.ts` sources next to the compiled
 * output in `dist/workflow/`.
 *
 * The generator vendors the engine into every generated project by reading its
 * source files at runtime (see `src/generator/engine-bundle.ts`). `tsc` only
 * emits `.js`, so without this copy a built/published `dist` package would have
 * no engine sources to read. Copying the sources keeps the built package
 * self-contained and identical in behavior to running from source.
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcWorkflow = join(repoRoot, "src", "workflow");
const distWorkflow = join(repoRoot, "dist", "workflow");

if (!existsSync(srcWorkflow)) {
  console.error(`copy-engine-sources: missing source directory ${srcWorkflow}`);
  process.exit(1);
}

mkdirSync(distWorkflow, { recursive: true });

const sources = readdirSync(srcWorkflow).filter((name) => name.endsWith(".ts"));
for (const name of sources) {
  cpSync(join(srcWorkflow, name), join(distWorkflow, name));
}

console.error(
  `copy-engine-sources: copied ${sources.length} engine source file(s) to dist/workflow`,
);
