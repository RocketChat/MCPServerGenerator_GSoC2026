import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  escapeBlockComment,
  escapeMarkdownCell,
} from "../../generator/escape.js";
import {
  assignModuleNames,
  sanitizeModuleName,
} from "../../generator/project.js";
import type { WorkflowDefinition } from "../../workflow/types.js";

describe("escapeBlockComment", () => {
  it("breaks a comment terminator so it cannot close the block", () => {
    const out = escapeBlockComment("*/ evil();");
    assert.ok(!out.includes("*/"), `still contains a terminator: ${out}`);
  });

  it("collapses newlines onto a single comment line", () => {
    assert.equal(escapeBlockComment("a\nb\r\nc"), "a b c");
  });

  it("neutralizes every terminator, not just the first", () => {
    const out = escapeBlockComment("a */ b */ c");
    assert.ok(!out.includes("*/"));
  });

  it("is safe on empty / nullish input", () => {
    assert.equal(escapeBlockComment(""), "");
    assert.equal(escapeBlockComment(undefined as unknown as string), "");
  });
});

describe("escapeMarkdownCell", () => {
  it("escapes pipes and drops newlines", () => {
    assert.equal(escapeMarkdownCell("a | b\nc"), "a \\| b c");
  });
});

describe("sanitizeModuleName", () => {
  it("reduces arbitrary names to a safe module basename", () => {
    assert.equal(sanitizeModuleName('evil"; run()//'), "evil_run");
    assert.equal(sanitizeModuleName("../../etc/passwd"), "etc_passwd");
    assert.equal(sanitizeModuleName("summarize_channel"), "summarize_channel");
  });

  it("guarantees a leading letter/underscore and never empties out", () => {
    assert.match(sanitizeModuleName("123"), /^[A-Za-z_]/);
    assert.equal(sanitizeModuleName("***"), "tool");
  });
});

describe("assignModuleNames", () => {
  it("disambiguates names that sanitize to the same basename", () => {
    const wf = (name: string): WorkflowDefinition => ({
      name,
      description: "",
      params: { type: "object", properties: {} },
      steps: [],
      requiredEndpoints: [],
      usesSampling: false,
      usesElicitation: false,
    });
    const names = assignModuleNames([wf("a b"), wf("a-b"), wf("a/b")]);
    assert.deepEqual(names, ["a_b", "a_b_2", "a_b_3"]);
  });
});
