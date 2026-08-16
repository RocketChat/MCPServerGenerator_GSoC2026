import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DslParseError, parseDsl } from "../../dsl/index.js";

describe("parseDsl – error cases", () => {
  describe("project-level errors", () => {
    it("throws on missing PROJECT", () => {
      const dsl = `
WORKFLOW w
  DESCRIPTION test
  STEP noop : transform
    EXPRESSION true
`;
      assert.throws(() => parseDsl(dsl), /Missing PROJECT/);
    });

    it("throws on missing DESCRIPTION", () => {
      const dsl = `
PROJECT test
WORKFLOW w
  DESCRIPTION test
  STEP noop : transform
    EXPRESSION true
`;
      assert.throws(() => parseDsl(dsl), /Missing project DESCRIPTION/);
    });

    it("throws on no workflows", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
`;
      assert.throws(() => parseDsl(dsl), /No WORKFLOW/);
    });

    it("throws on duplicate DESCRIPTION at project level", () => {
      const dsl = `
PROJECT test
DESCRIPTION first description
DESCRIPTION second description
WORKFLOW w
  DESCRIPTION test
  STEP t : transform
    EXPRESSION true
`;
      assert.throws(
        () => parseDsl(dsl),
        /Duplicate DESCRIPTION at project level/,
      );
    });

    it("throws on unexpected content at root level", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
BOGUS line
WORKFLOW w
  DESCRIPTION test
  STEP t : transform
    EXPRESSION true
`;
      assert.throws(() => parseDsl(dsl), /Unexpected content at root level/);
    });

    it("throws on bare WORKFLOW keyword (no name) at root level", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW
`;
      assert.throws(() => parseDsl(dsl), /WORKFLOW requires a name/);
    });
  });

  describe("workflow-level errors", () => {
    it("throws on workflow with zero steps", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW empty
  DESCRIPTION does nothing
`;
      assert.throws(
        () => parseDsl(dsl),
        /WORKFLOW "empty" has no STEP declarations/,
      );
    });

    it("throws on duplicate workflow names", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW search
  DESCRIPTION First search
  STEP a : transform
    EXPRESSION 1

WORKFLOW search
  DESCRIPTION Second search
  STEP b : transform
    EXPRESSION 2
`;
      assert.throws(() => parseDsl(dsl), /Duplicate WORKFLOW name "search"/);
    });

    it("throws on duplicate DESCRIPTION in a workflow", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION first
  DESCRIPTION second
  STEP t : transform
    EXPRESSION true
`;
      assert.throws(
        () => parseDsl(dsl),
        /Duplicate DESCRIPTION in workflow "w"/,
      );
    });

    it("throws on duplicate step IDs within a workflow", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP dup : transform
    EXPRESSION 1
  STEP dup : transform
    EXPRESSION 2
`;
      assert.throws(() => parseDsl(dsl), /Duplicate step ID "dup"/);
    });

    it("throws on unknown keyword in a workflow", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  UNKNOWN stuff
`;
      assert.throws(() => parseDsl(dsl), /Unknown keyword "UNKNOWN"/);
    });

    it("throws on duplicate PARAM in a workflow", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  PARAM query : string : first
  PARAM query : string : second
  STEP t : transform
    EXPRESSION true
`;
      assert.throws(
        () => parseDsl(dsl),
        /Duplicate PARAM "query" in workflow "w"/,
      );
    });
  });

  describe("step-level errors", () => {
    it("throws on invalid step type", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP bad : unknown_type
    EXPRESSION true
`;
      assert.throws(() => parseDsl(dsl), /Unknown step type/);
    });

    it("throws on extra text after STEP type", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP bad : api_call some text
    OPERATION op
`;
      assert.throws(
        () => parseDsl(dsl),
        /Unexpected text "some text" after step type "api_call"/,
      );
    });

    it("throws on STEP without colon separator", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP bad_step transform
`;
      assert.throws(() => parseDsl(dsl), /STEP requires format/);
    });

    it("throws on STEP with empty id before colon", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP : transform
`;
      assert.throws(() => parseDsl(dsl), /STEP requires an id/);
    });

    it("throws on STEP with empty type after colon", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP myStep :
`;
      assert.throws(() => parseDsl(dsl), /STEP requires a type/);
    });

    it("throws helpful error on bare STEP keyword", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP
`;
      assert.throws(() => parseDsl(dsl), /STEP requires format/);
    });

    it("throws on unknown keyword in a step", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : api_call
    OPERATION op
    BADKEYWORD value
`;
      assert.throws(() => parseDsl(dsl), /Unknown keyword "BADKEYWORD"/);
    });

    it("throws on DESCRIPTION inside a step", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : transform
    DESCRIPTION This should be a label
`;
      assert.throws(
        () => parseDsl(dsl),
        /DESCRIPTION is not valid inside a STEP/,
      );
    });

    it("throws on duplicate OPERATION in a step", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : api_call
    OPERATION first
    OPERATION second
`;
      assert.throws(() => parseDsl(dsl), /Duplicate OPERATION/);
    });

    it("throws on text that looks like heredoc content in step body", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : sampling
    PROMPT <<<
      the prompt
    >>>
    - bullet point text
`;
      assert.throws(() => parseDsl(dsl), /looks like text meant for a heredoc/);
    });

    it("throws on invalid ON_DECLINE value", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP ask : elicitation
    MESSAGE Do you approve?
    ON_DECLINE some_invalid_value
`;
      assert.throws(
        () => parseDsl(dsl),
        (err: unknown) =>
          err instanceof DslParseError &&
          /ON_DECLINE must be "abort" or "skip_remaining"/.test(err.message),
      );
    });

    it("accepts ON_DECLINE abort", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP ask : elicitation
    MESSAGE Do you approve?
    ON_DECLINE abort
`;
      const result = parseDsl(dsl);
      assert.equal(result.workflows[0].steps[0].onDecline, "abort");
    });
  });

  describe("MAP errors", () => {
    it("throws on MAP with empty value after =", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : api_call
    OPERATION op
    MAP key =
`;
      assert.throws(
        () => parseDsl(dsl),
        /MAP "key" requires a value after '='/,
      );
    });

    it("throws on MAP with heredoc syntax", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : api_call
    OPERATION test-op
    MAP body = <<<
`;
      assert.throws(() => parseDsl(dsl), /MAP does not support heredoc/);
    });

    it("throws on MAP without equals sign", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : api_call
    OPERATION op
    MAP channelGeneral
`;
      assert.throws(() => parseDsl(dsl), /MAP requires format/);
    });

    it("throws on MAP with empty field path before =", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : api_call
    OPERATION op
    MAP = someValue
`;
      assert.throws(() => parseDsl(dsl), /MAP requires a field path/);
    });
  });

  describe("PARAM errors", () => {
    it("rejects PARAM with invalid type", () => {
      const dsl = `
PROJECT param-test3
DESCRIPTION Bad type

WORKFLOW w
  DESCRIPTION test
  PARAM x : integer

  STEP s : transform
    EXPRESSION true
`;
      assert.throws(() => parseDsl(dsl), /PARAM type "integer" invalid/);
    });

    it("rejects PARAM without a colon separator", () => {
      const dsl = `
PROJECT param-test4
DESCRIPTION Missing colon

WORKFLOW w
  DESCRIPTION test
  PARAM query

  STEP s : transform
    EXPRESSION true
`;
      assert.throws(() => parseDsl(dsl), /PARAM requires format/);
    });

    it("rejects PARAM with empty name before colon", () => {
      const dsl = `
PROJECT param-test5
DESCRIPTION Empty param name

WORKFLOW w
  DESCRIPTION test
  PARAM : string

  STEP s : transform
    EXPRESSION true
`;
      assert.throws(() => parseDsl(dsl), /PARAM requires a name before ':'/);
    });
  });

  describe("heredoc and keyword errors", () => {
    it("throws on unterminated heredoc", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : transform
    EXPRESSION <<<
      some code here
`;
      assert.throws(() => parseDsl(dsl), /Unterminated heredoc/);
    });

    it("throws on bare EXPRESSION", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : transform
    EXPRESSION
`;
      assert.throws(() => parseDsl(dsl), /EXPRESSION requires/);
    });

    it("throws on bare CONDITION (no value, no heredoc)", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : conditional
    CONDITION
`;
      assert.throws(() => parseDsl(dsl), /CONDITION requires/);
    });

    it("throws on bare PROMPT (no value, no heredoc)", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : sampling
    PROMPT
`;
      assert.throws(() => parseDsl(dsl), /PROMPT requires/);
    });

    it("throws on bare SYSTEM_PROMPT (no value, no heredoc)", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : sampling
    PROMPT question
    SYSTEM_PROMPT
`;
      assert.throws(() => parseDsl(dsl), /SYSTEM_PROMPT requires/);
    });

    it("throws on bare MESSAGE (no value, no heredoc)", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : elicitation
    MESSAGE
`;
      assert.throws(() => parseDsl(dsl), /MESSAGE requires/);
    });

    it("throws on bare CONTENT_TEXT (no value, no heredoc)", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : sampling
    CONTENT_TEXT
`;
      assert.throws(() => parseDsl(dsl), /CONTENT_TEXT requires/);
    });

    it("throws on bare SCHEMA (no value, no heredoc)", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : elicitation
    MESSAGE question
    SCHEMA
`;
      assert.throws(() => parseDsl(dsl), /SCHEMA requires/);
    });

    it("throws on invalid SCHEMA JSON", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP ask : elicitation
    MESSAGE test
    SCHEMA {not valid json}
`;
      assert.throws(() => parseDsl(dsl), /SCHEMA value must be valid JSON/);
    });

    it("throws on invalid SCHEMA JSON in heredoc", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : elicitation
    MESSAGE question
    SCHEMA <<<
      {invalid json here}
    >>>
`;
      assert.throws(() => parseDsl(dsl), /Invalid JSON in SCHEMA heredoc/);
    });

    it("throws on MAX_TOKENS with non-numeric value", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : sampling
    PROMPT question
    MAX_TOKENS lots
`;
      assert.throws(() => parseDsl(dsl), /MAX_TOKENS must be a number/);
    });
  });

  describe("semantic validation errors", () => {
    it("throws on api_call step without OPERATION", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : api_call
    MAP channel = #general
`;
      assert.throws(
        () => parseDsl(dsl),
        /Step "t" \(api_call\) requires OPERATION/,
      );
    });

    it("throws on sampling step without PROMPT or CONTENT_TEXT", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : sampling
    RESPONSE_FORMAT json
`;
      assert.throws(
        () => parseDsl(dsl),
        /Step "t" \(sampling\) requires PROMPT or CONTENT_TEXT/,
      );
    });

    it("throws on conditional step without CONDITION", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : conditional
    THEN next
`;
      assert.throws(
        () => parseDsl(dsl),
        /Step "t" \(conditional\) requires CONDITION/,
      );
    });

    it("throws on conditional step without THEN or ELSE", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : conditional
    CONDITION true
`;
      assert.throws(
        () => parseDsl(dsl),
        /Step "t" \(conditional\) requires at least THEN or ELSE/,
      );
    });

    it("throws on transform step without EXPRESSION", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : transform
`;
      assert.throws(
        () => parseDsl(dsl),
        /Step "t" \(transform\) requires EXPRESSION/,
      );
    });

    it("throws on elicitation step without MESSAGE", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : elicitation
    SCHEMA {"type":"object"}
`;
      assert.throws(
        () => parseDsl(dsl),
        /Step "t" \(elicitation\) requires MESSAGE/,
      );
    });

    it("throws on FOR_EACH without AS", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : api_call
    OPERATION op
    FOR_EACH {{steps.items}}
`;
      assert.throws(() => parseDsl(dsl), /Step "t" has FOR_EACH without AS/);
    });

    it("throws on AS without FOR_EACH", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : api_call
    OPERATION op
    AS item
`;
      assert.throws(() => parseDsl(dsl), /Step "t" has AS without FOR_EACH/);
    });
  });

  describe("reference validation errors", () => {
    it("throws when THEN references non-existent step", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP gate : conditional
    CONDITION true
    THEN ghost_step
`;
      assert.throws(
        () => parseDsl(dsl),
        /THEN references unknown step "ghost_step"/,
      );
    });

    it("throws when ELSE references non-existent step", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP a : transform
    EXPRESSION true
  STEP gate : conditional
    CONDITION true
    THEN a
    ELSE ghost_step
`;
      assert.throws(
        () => parseDsl(dsl),
        /ELSE references unknown step "ghost_step"/,
      );
    });

    it("throws when DEPENDS ON references non-existent step", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP a : transform
    DEPENDS ON phantom
    EXPRESSION true
`;
      assert.throws(() => parseDsl(dsl), /DEPENDS ON unknown step "phantom"/);
    });
  });

  describe("webhook errors", () => {
    it("throws on bare WEBHOOK keyword (no path)", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : transform
    EXPRESSION true
WEBHOOK
`;
      assert.throws(() => parseDsl(dsl), /WEBHOOK requires a path/);
    });

    it("throws on WEBHOOK without METHODS", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : transform
    EXPRESSION true
WEBHOOK /api/hook
  DESCRIPTION A hook without methods
`;
      assert.throws(
        () => parseDsl(dsl),
        /WEBHOOK "\/api\/hook" requires at least one method/,
      );
    });

    it("throws on invalid webhook method", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : transform
    EXPRESSION true
WEBHOOK /hook
  DESCRIPTION test hook
  METHODS put
`;
      assert.throws(() => parseDsl(dsl), /Invalid HTTP method "put"/);
    });

    it("throws on unknown keyword in WEBHOOK block", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : transform
    EXPRESSION true
WEBHOOK /hook
  DESCRIPTION test hook
  UNKNOWN stuff
`;
      assert.throws(() => parseDsl(dsl), /Unknown keyword in WEBHOOK/);
    });
  });

  describe("line number reporting", () => {
    it("reports correct line number for unterminated heredoc", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : transform
    EXPRESSION <<<
      some code here
`;
      assert.throws(
        () => parseDsl(dsl),
        (error: unknown) =>
          error instanceof DslParseError &&
          error.line === 7 &&
          /Unterminated heredoc/.test(error.message),
      );
    });

    it("reports correct line number for duplicate OPERATION", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : api_call
    OPERATION first
    OPERATION second
`;
      assert.throws(
        () => parseDsl(dsl),
        (error: unknown) =>
          error instanceof DslParseError &&
          error.line === 8 &&
          /Duplicate OPERATION/.test(error.message),
      );
    });

    it("reports correct line number for STEP format error", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP bad_step transform
`;
      assert.throws(
        () => parseDsl(dsl),
        (error: unknown) =>
          error instanceof DslParseError &&
          error.line === 6 &&
          /STEP requires format/.test(error.message),
      );
    });

    it("reports correct line number for MAP format error", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : api_call
    OPERATION op
    MAP noEqualsHere
`;
      assert.throws(
        () => parseDsl(dsl),
        (error: unknown) =>
          error instanceof DslParseError &&
          error.line === 8 &&
          /MAP requires format/.test(error.message),
      );
    });

    it("reports correct line number for bare EXPRESSION", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : transform
    EXPRESSION
`;
      assert.throws(
        () => parseDsl(dsl),
        (error: unknown) =>
          error instanceof DslParseError &&
          error.line === 7 &&
          /EXPRESSION requires/.test(error.message),
      );
    });

    it("DslParseError has correct name, line, and message format", () => {
      const dsl = `
PROJECT test
DESCRIPTION test
`;
      try {
        parseDsl(dsl);
        assert.fail("Expected DslParseError to be thrown");
      } catch (raw: unknown) {
        const err = raw as DslParseError;
        assert.ok(raw instanceof DslParseError);
        assert.equal(err.name, "DslParseError");
        assert.equal(typeof err.line, "number");
        assert.ok(err.message.startsWith(`Line ${err.line}:`));
      }
    });
  });
});
