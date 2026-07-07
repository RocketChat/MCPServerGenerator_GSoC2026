import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { handleGenerate } from "../../tools/generate.js";
import type {
  FullEndpoint,
  GetFullEndpointsResult,
} from "../../parser/types.js";

function makeEndpoint(
  operationId: string,
  method: string,
  path: string,
): FullEndpoint {
  return {
    operationId,
    method,
    path,
    summary: "",
    description: "",
    domain: "messaging",
    parameters: [],
    security: [],
    inputSchema: { type: "object" },
    parameterSchemas: {},
  } as unknown as FullEndpoint;
}

/** Parser stub that resolves a fixed set of endpoints plus an optional correction map. */
function stubParser(
  endpoints: FullEndpoint[],
  correctedIds: Map<string, string> = new Map(),
) {
  return {
    async getFullEndpoints(): Promise<GetFullEndpointsResult> {
      return { endpoints, correctedIds };
    },
  };
}

const DSL = `
PROJECT resolve_test
DESCRIPTION operationId resolution behavior

WORKFLOW w
  DESCRIPTION single api call
  PARAM roomId : string : Target room

  STEP fetch : api_call
    OPERATION channels.history
    MAP roomId = {{params.roomId}}
`;

describe("generate fails closed on unresolved operationIds", () => {
  const outputDir = join(process.cwd(), ".tmp-fail-closed-test");
  after(() => rmSync(outputDir, { recursive: true, force: true }));

  it("returns an error and writes nothing when an operationId is unknown", async () => {
    const response = await handleGenerate(stubParser([]), {
      dsl: DSL,
      outputDir,
    });
    assert.ok(
      "isError" in response && response.isError,
      "expected an error result",
    );
    assert.match(response.content[0].text, /could not be resolved/);
    assert.match(response.content[0].text, /channels\.history/);
    assert.ok(
      !existsSync(join(outputDir, "resolve_test")),
      "no project should be written on failure",
    );
  });
});

describe("generate rewrites auto-corrected operationIds before generating", () => {
  const outputDir = join(process.cwd(), ".tmp-corrected-test");
  after(() => rmSync(outputDir, { recursive: true, force: true }));

  it("embeds the corrected id in both the tool and the endpoint map", async () => {
    const parser = stubParser(
      [makeEndpoint("channels-history", "GET", "/api/v1/channels.history")],
      new Map([["channels.history", "channels-history"]]),
    );

    const response = await handleGenerate(parser, { dsl: DSL, outputDir });
    assert.ok(
      !("isError" in response && response.isError),
      response.content[0].text,
    );
    assert.match(response.content[0].text, /Auto-corrected operationIds/);

    const root = join(outputDir, "resolve_test");
    const tool = readFileSync(join(root, "src", "tools", "w.ts"), "utf8");
    const endpointsFile = readFileSync(
      join(root, "src", "endpoints.ts"),
      "utf8",
    );

    // The embedded workflow must reference the corrected id, never the stale one.
    assert.match(tool, /"operationId": "channels-history"/);
    assert.ok(!tool.includes('"operationId": "channels.history"'));
    assert.match(endpointsFile, /"channels-history"/);
  });
});
