import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateFromDsl } from "../../generator/pipeline.js";
import { generateProject } from "../../generator/project.js";
import type { WorkflowDefinition } from "../../workflow/types.js";

/**
 * A DESCRIPTION crafted to break out of the generated block comment. The
 * composer validates workflow *names* but not free-text descriptions, so the
 * generator must neutralize the comment terminator itself.
 */
const HOSTILE_DSL = `
PROJECT hostile_project
DESCRIPTION top-level description

WORKFLOW evil_flow
  DESCRIPTION close comment */ globalThis.PWNED = 2; /* reopen
  STEP only : api_call
    OPERATION channels.history
    MAP roomId = room1
`;

function fileMap(
  files: { path: string; content: string }[],
): Map<string, string> {
  return new Map(files.map((f) => [f.path, f.content]));
}

describe("generated code is safe from a hostile DSL description", () => {
  const result = generateFromDsl(HOSTILE_DSL, { endpoints: [] });
  const files = fileMap(result.files);
  const tool = files.get("src/tools/evil_flow.ts")!;

  it("does not let the description escape its block comment", () => {
    // The first `*/` in the file must be the header comment's own terminator.
    // If the description's `*/` were left raw it would become the first
    // terminator and the payload would spill out as code before it.
    const terminator = tool.indexOf("*/");
    assert.ok(terminator >= 0, "expected a header comment terminator");
    const header = tool.slice(0, terminator);
    assert.ok(
      header.includes("globalThis.PWNED = 2;"),
      "the description broke out of the header comment",
    );
    assert.ok(header.includes("*\\/"), "the terminator was not neutralized");
  });

  it("keeps the description as an inert escaped string literal", () => {
    // `*/` inside a double-quoted string literal is harmless; JSON.stringify
    // produces a valid literal for the description field.
    assert.ok(
      tool.includes(
        'description: "close comment */ globalThis.PWNED = 2; /* reopen"',
      ),
    );
  });
});

describe("generateProject sanitizes unconstrained workflow names (defense in depth)", () => {
  // generateProject can be called directly with a WorkflowDefinition that never
  // passed composer name validation, so it must not trust the name.
  const hostile: WorkflowDefinition = {
    name: 'x"; globalThis.PWNED = 1; //',
    description: "d",
    params: { type: "object", properties: {} },
    steps: [
      { id: "s", label: "s", config: { type: "transform", expression: "1" } },
    ],
    requiredEndpoints: [],
    usesSampling: false,
    usesElicitation: false,
  };

  const result = generateProject({
    serverName: "safe_server",
    workflows: [hostile],
    endpoints: [],
  });
  const files = fileMap(result.files);

  it("writes the tool under a safe module basename", () => {
    const toolPaths = [...files.keys()].filter((p) =>
      p.startsWith("src/tools/"),
    );
    assert.equal(toolPaths.length, 1);
    assert.match(toolPaths[0], /^src\/tools\/[A-Za-z0-9_]+\.ts$/);
  });

  it("emits a safe, quote-free import specifier in the server entry", () => {
    const server = files.get("src/server.ts")!;
    const importMatch = server.match(/from "(\.\/tools\/[^"]+)"/);
    assert.ok(importMatch, "expected a tool import in server.ts");
    assert.match(importMatch![1], /^\.\/tools\/[A-Za-z0-9_]+\.js$/);
    assert.ok(!server.includes("globalThis.PWNED"));
  });
});
