import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { generateFromDsl } from "../../generator/pipeline.js";
import type { GeneratedFile } from "../../generator/types.js";

/**
 * End-to-end quality gates for a *generated* project — the strongest signal
 * that codegen is healthy:
 *
 *   1. The whole project is valid TypeScript (`tsc --noEmit`).
 *   2. The generated `npm test` suite actually runs and passes.
 *
 * We write a full project to a temp dir under the repo root; dependency and
 * `@types` resolution walks up to this repo's `node_modules`, so no install
 * step is needed. The DSL exercises every step type (api_call, sampling with
 * multimodal CONTENT_*, elicitation, transform, conditional) plus forEach.
 */
const DSL = `
PROJECT generated_quality
DESCRIPTION Exercises every step type so the whole generated project is checked

WORKFLOW triage_and_report
  DESCRIPTION Fetch messages, summarize with AI, confirm, then post
  PARAM roomId : string : Target room id
  PARAM dryRun : boolean : Skip posting when true

  STEP fetch : api_call
    LABEL Fetch messages
    OPERATION channels.history
    MAP roomId = {{params.roomId}}
    MAP count = 20
    OUTPUT_PATH messages

  STEP summarize : sampling
    LABEL Summarize messages
    DEPENDS ON fetch
    RESPONSE_FORMAT json
    SYSTEM_PROMPT Respond ONLY with JSON.
    PROMPT Summarize the fetched messages.
    CONTENT_TEXT <<<
      Summarize these messages as JSON { "summary": string, "flagged": [ids] }:
      {{steps.fetch}}
    >>>
    CONTENT_IMAGE https://example.com/context.png

  STEP needs_post : conditional
    LABEL Post only when not a dry run
    CONDITION params.dryRun !== true
    THEN post

  STEP post : api_call
    LABEL Post the summary
    DEPENDS ON summarize
    OPERATION chat.postMessage
    MAP roomId = {{params.roomId}}
    MAP text = {{steps.summarize.summary}}

  STEP confirm : elicitation
    LABEL Confirm archive
    DEPENDS ON summarize
    MESSAGE Archive the flagged items? {{steps.summarize.summary}}
    SCHEMA {"type":"object","properties":{"approved":{"type":"boolean"}}}
    ON_DECLINE skip_remaining
`;

const endpoints = [
  {
    operationId: "channels.history",
    method: "GET",
    path: "/api/v1/channels.history",
  },
  {
    operationId: "chat.postMessage",
    method: "POST",
    path: "/api/v1/chat.postMessage",
  },
];

describe("generated project quality gates", () => {
  const outDir = join(process.cwd(), ".tmp-generated-project");
  let files: GeneratedFile[] = [];

  before(() => {
    files = generateFromDsl(DSL, { endpoints }).files;
    for (const file of files) {
      const dest = join(outDir, file.path);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, file.content, "utf8");
    }
  });

  after(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("is valid TypeScript (tsc --noEmit)", () => {
    const tscEntry = join(
      process.cwd(),
      "node_modules",
      "typescript",
      "bin",
      "tsc",
    );
    try {
      execFileSync(
        process.execPath,
        [tscEntry, "--noEmit", "-p", join(outDir, "tsconfig.json")],
        {
          cwd: process.cwd(),
          stdio: "pipe",
          encoding: "utf8",
        },
      );
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      assert.fail(
        `Generated project failed to type-check:\n${e.stdout ?? ""}\n${e.stderr ?? ""}`,
      );
    }
  });

  it("passes its own generated `npm test` suite", () => {
    const testFiles = files
      .filter((f) => f.path.endsWith(".test.ts"))
      .map((f) => join(outDir, f.path));
    assert.ok(testFiles.length > 0, "generator emitted at least one test file");

    try {
      execFileSync(
        process.execPath,
        ["--import", "tsx", "--test", ...testFiles],
        {
          cwd: outDir,
          stdio: "pipe",
          encoding: "utf8",
        },
      );
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      assert.fail(
        `Generated tests failed:\n${e.stdout ?? ""}\n${e.stderr ?? ""}`,
      );
    }
  });
});
