import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDsl, DslParseError } from "../../dsl/index.js";

describe("parseDsl - basic parsing", () => {
  it("parses a minimal project with one workflow and one step", () => {
    const dsl = `
PROJECT my-bot
DESCRIPTION A simple bot

WORKFLOW greet
  DESCRIPTION Greets users

  STEP say_hi : api_call
    LABEL Say Hi
    OPERATION post-api-v1-chat_postMessage
    MAP channel = #general
    MAP text = Hello!
`;
    const result = parseDsl(dsl);
    assert.equal(result.projectName, "my-bot");
    assert.equal(result.description, "A simple bot");
    assert.equal(result.workflows.length, 1);
    assert.equal(result.workflows[0].name, "greet");
    assert.equal(result.workflows[0].description, "Greets users");
    assert.equal(result.workflows[0].steps.length, 1);

    const step = result.workflows[0].steps[0];
    assert.equal(step.id, "say_hi");
    assert.equal(step.type, "api_call");
    assert.equal(step.label, "Say Hi");
    assert.equal(step.operationId, "post-api-v1-chat_postMessage");
    assert.deepEqual(step.inputMapping, {
      channel: "#general",
      text: "Hello!",
    });
  });

  it("ignores comments and blank lines", () => {
    const dsl = `
# This is a comment
PROJECT comment-test
DESCRIPTION Test comments

# Another comment
WORKFLOW w
  DESCRIPTION test

  # Step comment
  STEP noop : transform
    EXPRESSION true
`;
    const result = parseDsl(dsl);
    assert.equal(result.projectName, "comment-test");
    assert.equal(result.workflows[0].steps.length, 1);
  });

  it("parses multiple workflows in one DSL", () => {
    const dsl = `
PROJECT multi-test
DESCRIPTION Multiple workflows

WORKFLOW first
  DESCRIPTION First workflow

  STEP a : transform
    EXPRESSION 1

WORKFLOW second
  DESCRIPTION Second workflow

  STEP b : transform
    EXPRESSION 2

WORKFLOW third
  DESCRIPTION Third workflow

  STEP c : transform
    EXPRESSION 3
`;
    const result = parseDsl(dsl);
    assert.equal(result.workflows.length, 3);
    assert.equal(result.workflows[0].name, "first");
    assert.equal(result.workflows[1].name, "second");
    assert.equal(result.workflows[2].name, "third");
  });

  it("parses inline single-line expression", () => {
    const dsl = `
PROJECT inline-test
DESCRIPTION Test inline

WORKFLOW w
  DESCRIPTION test

  STEP check : transform
    EXPRESSION params.message ? true : false
`;
    const result = parseDsl(dsl);
    assert.equal(
      result.workflows[0].steps[0].expression,
      "params.message ? true : false",
    );
  });

  it("parses CONTINUE_ON_ERROR flag", () => {
    const dsl = `
PROJECT err-test
DESCRIPTION Test continueOnError

WORKFLOW w
  DESCRIPTION test

  STEP risky : api_call
    OPERATION post-api-v1-chat_postMessage
    MAP channel = #test
    MAP text = hi
    CONTINUE_ON_ERROR
`;
    const result = parseDsl(dsl);
    assert.equal(result.workflows[0].steps[0].continueOnError, true);
  });

  it("parses OUTPUT_PATH", () => {
    const dsl = `
PROJECT path-test
DESCRIPTION Test outputPath

WORKFLOW w
  DESCRIPTION test

  STEP get : api_call
    OPERATION get-api-v1-channels_list
    OUTPUT_PATH channels
`;
    const result = parseDsl(dsl);
    assert.equal(result.workflows[0].steps[0].outputPath, "channels");
  });
});

describe("parseDsl - step types", () => {
  describe("api_call steps", () => {
    it("parses DEPENDS ON with multiple steps", () => {
      const dsl = `
PROJECT deps-test
DESCRIPTION Test dependencies

WORKFLOW w
  DESCRIPTION test

  STEP root : transform
    EXPRESSION true

  STEP a : transform
    DEPENDS ON root
    EXPRESSION 1

  STEP b : transform
    DEPENDS ON root a
    EXPRESSION 2
`;
      const result = parseDsl(dsl);
      assert.deepEqual(result.workflows[0].steps[1].dependsOn, ["root"]);
      assert.deepEqual(result.workflows[0].steps[2].dependsOn, ["root", "a"]);
    });

    it("parses FOR_EACH and AS", () => {
      const dsl = `
PROJECT loop-test
DESCRIPTION Test forEach

WORKFLOW w
  DESCRIPTION test

  STEP get_items : api_call
    OPERATION get-api-v1-channels_list

  STEP process : api_call
    DEPENDS ON get_items
    OPERATION get-api-v1-chat_getPinnedMessages
    FOR_EACH {{steps.get_items.channels}}
    AS chan
    MAP roomId = {{chan._id}}
    MAP count = 20
`;
      const result = parseDsl(dsl);
      const step = result.workflows[0].steps[1];
      assert.equal(step.forEach, "{{steps.get_items.channels}}");
      assert.equal(step.as, "chan");
    });
  });

  describe("conditional steps", () => {
    it("parses conditional with THEN and ELSE", () => {
      const dsl = `
PROJECT cond-test
DESCRIPTION Test conditional

WORKFLOW w
  DESCRIPTION test

  STEP check : transform
    EXPRESSION true

  STEP gate : conditional
    DEPENDS ON check
    CONDITION steps.check === true
    THEN handle_yes
    ELSE handle_no

  STEP handle_yes : api_call
    DEPENDS ON gate
    OPERATION post-api-v1-chat_postMessage
    MAP channel = #general
    MAP text = Yes

  STEP handle_no : api_call
    DEPENDS ON gate
    OPERATION post-api-v1-chat_postMessage
    MAP channel = #general
    MAP text = No
`;
      const result = parseDsl(dsl);
      const gate = result.workflows[0].steps[1];
      assert.equal(gate.type, "conditional");
      assert.equal(gate.condition, "steps.check === true");
      assert.equal(gate.thenStep, "handle_yes");
      assert.equal(gate.elseStep, "handle_no");
    });

    it("parses conditional with THEN only (no ELSE)", () => {
      const dsl = `
PROJECT cond-test
DESCRIPTION Test conditional no else

WORKFLOW w
  DESCRIPTION test

  STEP check : transform
    EXPRESSION true

  STEP gate : conditional
    DEPENDS ON check
    CONDITION steps.check !== null
    THEN proceed

  STEP proceed : transform
    DEPENDS ON gate
    EXPRESSION "continuing"
`;
      const result = parseDsl(dsl);
      const gate = result.workflows[0].steps[1];
      assert.equal(gate.thenStep, "proceed");
      assert.equal(gate.elseStep, undefined);
    });
  });

  describe("sampling steps", () => {
    it("parses sampling with systemPrompt, responseFormat, maxTokens", () => {
      const dsl = `
PROJECT sampling-test
DESCRIPTION Test sampling

WORKFLOW w
  DESCRIPTION test

  STEP analyze : sampling
    SYSTEM_PROMPT You are an analyst.
    PROMPT Analyze: {{params.query}}
    RESPONSE_FORMAT json
    MAX_TOKENS 2000
`;
      const result = parseDsl(dsl);
      const step = result.workflows[0].steps[0];
      assert.equal(step.type, "sampling");
      assert.equal(step.systemPrompt, "You are an analyst.");
      assert.equal(step.prompt, "Analyze: {{params.query}}");
      assert.equal(step.responseFormat, "json");
      assert.equal(step.maxTokens, 2000);
    });

    it("parses CONTENT_TEXT and CONTENT_IMAGE", () => {
      const dsl = `
PROJECT content-test
DESCRIPTION Test content array

WORKFLOW w
  DESCRIPTION test

  STEP analyze : sampling
    CONTENT_TEXT Does this image violate content policy?
    CONTENT_IMAGE {{steps.extract}}
    RESPONSE_FORMAT json
`;
      const result = parseDsl(dsl);
      const step = result.workflows[0].steps[0];
      assert.deepEqual(step.content, [
        { type: "text", text: "Does this image violate content policy?" },
        { type: "image", url: "{{steps.extract}}" },
      ]);
    });
  });

  describe("elicitation steps", () => {
    it("parses elicitation with SCHEMA and ON_DECLINE", () => {
      const dsl = `
PROJECT elicit-test
DESCRIPTION Test elicitation

WORKFLOW w
  DESCRIPTION test

  STEP ask : elicitation
    MESSAGE How should I format the results?
    SCHEMA {"type":"object","properties":{"format":{"type":"string","enum":["brief","detailed"]}},"required":["format"]}
    ON_DECLINE skip_remaining
`;
      const result = parseDsl(dsl);
      const step = result.workflows[0].steps[0];
      assert.equal(step.type, "elicitation");
      assert.equal(step.message, "How should I format the results?");
      assert.deepEqual(step.requestedSchema, {
        type: "object",
        properties: {
          format: { type: "string", enum: ["brief", "detailed"] },
        },
        required: ["format"],
      });
      assert.equal(step.onDecline, "skip_remaining");
    });
  });
});

describe("parseDsl - MAP keyword", () => {
  it("reconstructs nested objects from MAP dot-paths", () => {
    const dsl = `
PROJECT map-test
DESCRIPTION Tests MAP syntax

WORKFLOW w
  DESCRIPTION test

  STEP send : api_call
    OPERATION post-api-v1-chat_sendMessage
    MAP message.rid = {{params.room.id}}
    MAP message.msg = Hello
    MAP message.tmid = {{params.threadId}}
`;
    const result = parseDsl(dsl);
    assert.deepEqual(result.workflows[0].steps[0].inputMapping, {
      message: {
        rid: "{{params.room.id}}",
        msg: "Hello",
        tmid: "{{params.threadId}}",
      },
    });
  });

  it("infers correct types for MAP values", () => {
    const dsl = `
PROJECT type-test
DESCRIPTION Tests value type inference

WORKFLOW w
  DESCRIPTION test

  STEP call : api_call
    OPERATION get-api-v1-channels_list
    MAP count = 5
    MAP sort = {"msgs": -1}
    MAP active = true
    MAP name = {{params.query}}
    MAP items = ["a", "b"]
`;
    const result = parseDsl(dsl);
    const mapping = result.workflows[0].steps[0].inputMapping!;
    assert.equal(mapping.count, 5);
    assert.deepEqual(mapping.sort, { msgs: -1 });
    assert.equal(mapping.active, true);
    assert.equal(mapping.name, "{{params.query}}");
    assert.deepEqual(mapping.items, ["a", "b"]);
  });

  it("preserves template expressions that look numeric as strings", () => {
    const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : api_call
    OPERATION op
    MAP count = {{params.count}}
`;
    const result = parseDsl(dsl);
    const mapping = result.workflows[0].steps[0].inputMapping!;
    assert.equal(mapping.count, "{{params.count}}");
    assert.equal(typeof mapping.count, "string");
  });

  it("handles negative numbers in MAP values", () => {
    const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : api_call
    OPERATION op
    MAP offset = -10
`;
    const result = parseDsl(dsl);
    assert.equal(result.workflows[0].steps[0].inputMapping!.offset, -10);
  });

  it("handles decimal numbers in MAP values", () => {
    const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : api_call
    OPERATION op
    MAP score = 3.14
`;
    const result = parseDsl(dsl);
    assert.equal(result.workflows[0].steps[0].inputMapping!.score, 3.14);
  });

  it("MAP boolean false is parsed as boolean, not string", () => {
    const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : api_call
    OPERATION op
    MAP active = false
`;
    const result = parseDsl(dsl);
    assert.equal(result.workflows[0].steps[0].inputMapping!.active, false);
    assert.equal(
      typeof result.workflows[0].steps[0].inputMapping!.active,
      "boolean",
    );
  });

  it("later MAP to same dot-path overwrites earlier value", () => {
    const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : api_call
    OPERATION op
    MAP config.timeout = 5000
    MAP config.timeout = 10000
`;
    const result = parseDsl(dsl);
    assert.deepEqual(result.workflows[0].steps[0].inputMapping, {
      config: { timeout: 10000 },
    });
  });

  it("deepMerge preserves sibling keys when overwriting nested path", () => {
    const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : api_call
    OPERATION op
    MAP config.host = localhost
    MAP config.port = 8080
    MAP config.host = remotehost
`;
    const result = parseDsl(dsl);
    assert.deepEqual(result.workflows[0].steps[0].inputMapping, {
      config: { host: "remotehost", port: 8080 },
    });
  });

  it("handles invalid JSON-looking MAP values as plain strings", () => {
    const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : api_call
    OPERATION op
    MAP data = {not: valid json}
`;
    const result = parseDsl(dsl);
    assert.equal(
      result.workflows[0].steps[0].inputMapping!.data,
      "{not: valid json}",
    );
  });

  it("handles MAP value with multiple equals signs", () => {
    const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : api_call
    OPERATION op
    MAP query = status=active&type=admin
`;
    const result = parseDsl(dsl);
    assert.equal(
      result.workflows[0].steps[0].inputMapping!.query,
      "status=active&type=admin",
    );
  });
});

describe("parseDsl - heredoc syntax", () => {
  it("parses heredoc expressions", () => {
    const dsl = `
PROJECT heredoc-test
DESCRIPTION Tests heredoc

WORKFLOW w
  DESCRIPTION test

  STEP merge : transform
    EXPRESSION <<<
      const a = steps.first || [];
      const b = steps.second || [];
      return [...a, ...b]
    >>>
`;
    const result = parseDsl(dsl);
    const expr = result.workflows[0].steps[0].expression!;
    assert.ok(expr.includes("const a = steps.first || [];"));
    assert.ok(expr.includes("return [...a, ...b]"));
  });

  it("parses heredoc prompts", () => {
    const dsl = `
PROJECT heredoc-test
DESCRIPTION Tests heredoc prompt

WORKFLOW w
  DESCRIPTION test

  STEP ask : sampling
    PROMPT <<<
      Query: {{params.query}}
      Results: {{steps.search}}
    >>>
    MAX_TOKENS 500
`;
    const result = parseDsl(dsl);
    const step = result.workflows[0].steps[0];
    assert.ok(step.prompt!.includes("Query: {{params.query}}"));
    assert.ok(step.prompt!.includes("Results: {{steps.search}}"));
    assert.equal(step.maxTokens, 500);
  });

  it("parses CONDITION via heredoc", () => {
    const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP gate : conditional
    CONDITION <<<
      steps.data.items.length > 0 &&
      steps.data.items[0].active === true
    >>>
    THEN proceed

  STEP proceed : transform
    DEPENDS ON gate
    EXPRESSION true
`;
    const result = parseDsl(dsl);
    const step = result.workflows[0].steps[0];
    assert.ok(step.condition!.includes("steps.data.items.length > 0"));
    assert.ok(step.condition!.includes("steps.data.items[0].active === true"));
  });

  it("parses MESSAGE via heredoc", () => {
    const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP ask : elicitation
    MESSAGE <<<
      Please choose a format for the results.
      Options: brief, detailed, or custom.
    >>>
    SCHEMA {"type":"object","properties":{"choice":{"type":"string"}}}
`;
    const result = parseDsl(dsl);
    const step = result.workflows[0].steps[0];
    assert.ok(step.message!.includes("Please choose a format"));
    assert.ok(step.message!.includes("Options: brief, detailed, or custom."));
  });

  it("parses SYSTEM_PROMPT via heredoc", () => {
    const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP llm : sampling
    SYSTEM_PROMPT <<<
      You are a helpful assistant.
      Always respond in JSON format.
    >>>
    PROMPT What is 2+2?
`;
    const result = parseDsl(dsl);
    const step = result.workflows[0].steps[0];
    assert.ok(step.systemPrompt!.includes("You are a helpful assistant."));
    assert.ok(step.systemPrompt!.includes("Always respond in JSON format."));
  });

  it("parses CONTENT_TEXT via heredoc", () => {
    const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP analyze : sampling
    CONTENT_TEXT <<<
      Analyze the following data:
      {{steps.data}}
      Be thorough.
    >>>
`;
    const result = parseDsl(dsl);
    const step = result.workflows[0].steps[0];
    assert.equal(step.content!.length, 1);
    assert.equal(step.content![0].type, "text");
    const text = (step.content![0] as { type: "text"; text: string }).text;
    assert.ok(text.includes("Analyze the following data:"));
    assert.ok(text.includes("{{steps.data}}"));
    assert.ok(text.includes("Be thorough."));
  });

  it("parses SCHEMA as heredoc JSON", () => {
    const dsl = `
PROJECT schema-heredoc
DESCRIPTION Test heredoc schema

WORKFLOW w
  DESCRIPTION test

  STEP ask : elicitation
    MESSAGE Pick format
    SCHEMA <<<
      {
        "type": "object",
        "properties": {
          "fmt": { "type": "string" }
        }
      }
    >>>
`;
    const result = parseDsl(dsl);
    assert.deepEqual(result.workflows[0].steps[0].requestedSchema, {
      type: "object",
      properties: { fmt: { type: "string" } },
    });
  });

  it("handles triple-brace templates in heredoc by normalizing to double", () => {
    const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : transform
    EXPRESSION <<<
      return {{{params.value}}}
    >>>
`;
    const result = parseDsl(dsl);
    assert.ok(
      result.workflows[0].steps[0].expression!.includes("{{params.value}}"),
    );
    assert.ok(!result.workflows[0].steps[0].expression!.includes("{{{"));
  });
});

describe("parseDsl - PARAM declarations", () => {
  it("parses PARAM declarations into workflow params", () => {
    const dsl = `
PROJECT param-test
DESCRIPTION Tests PARAM syntax

WORKFLOW search
  DESCRIPTION Search rooms
  PARAM query : string : The search query
  PARAM room_id : string : The room to search in
  PARAM limit : number : Max results

  STEP do_search : api_call
    OPERATION get-api-v1-chat_search
    MAP roomId = {{params.room_id}}
    MAP searchText = {{params.query}}
`;
    const result = parseDsl(dsl);
    assert.equal(result.workflows.length, 1);
    const wf = result.workflows[0];
    assert.ok(wf.params);
    const props = wf.params!.properties;
    assert.deepEqual(props.query, {
      type: "string",
      description: "The search query",
    });
    assert.deepEqual(props.room_id, {
      type: "string",
      description: "The room to search in",
    });
    assert.deepEqual(props.limit, {
      type: "number",
      description: "Max results",
    });
  });

  it("parses PARAM without description", () => {
    const dsl = `
PROJECT param-test2
DESCRIPTION Minimal params

WORKFLOW w
  DESCRIPTION test
  PARAM flag : boolean

  STEP s : transform
    EXPRESSION true
`;
    const result = parseDsl(dsl);
    const props = result.workflows[0].params!.properties;
    assert.deepEqual(props.flag, { type: "boolean" });
  });

  it("PARAM with colons in description preserves the full description", () => {
    const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  PARAM query : string : The search query: supports wildcards
  STEP t : transform
    EXPRESSION true
`;
    const result = parseDsl(dsl);
    const props = result.workflows[0].params!.properties;
    assert.equal(
      props.query.description,
      "The search query: supports wildcards",
    );
  });

  it("workflow without params has undefined params field", () => {
    const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : transform
    EXPRESSION true
`;
    const result = parseDsl(dsl);
    assert.equal(result.workflows[0].params, undefined);
  });
});

describe("parseDsl - WEBHOOK endpoints", () => {
  it("parses WEBHOOK endpoints", () => {
    const dsl = `
PROJECT webhook-test
DESCRIPTION Test webhooks

WORKFLOW w
  DESCRIPTION test

  STEP noop : transform
    EXPRESSION true

WEBHOOK /incoming-alert
  DESCRIPTION Receives external alert payloads
  METHODS post

WEBHOOK /status
  DESCRIPTION Health check
  METHODS get post
`;
    const result = parseDsl(dsl);
    assert.equal(result.webhookEndpoints!.length, 2);
    assert.equal(result.webhookEndpoints![0].path, "/incoming-alert");
    assert.equal(
      result.webhookEndpoints![0].description,
      "Receives external alert payloads",
    );
    assert.deepEqual(result.webhookEndpoints![0].methods, ["post"]);
    assert.deepEqual(result.webhookEndpoints![1].methods, ["get", "post"]);
  });

  it("webhookEndpoints is undefined when no webhooks are declared", () => {
    const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : transform
    EXPRESSION true
`;
    const result = parseDsl(dsl);
    assert.equal(result.webhookEndpoints, undefined);
  });
});

describe("parseDsl - edge cases", () => {
  it("throws on empty string input", () => {
    assert.throws(
      () => parseDsl(""),
      (err: unknown) =>
        err instanceof DslParseError && /Missing PROJECT/.test(err.message),
    );
  });

  it("throws on whitespace-only input", () => {
    assert.throws(
      () => parseDsl("   \n\n  "),
      (err: unknown) =>
        err instanceof DslParseError && /Missing PROJECT/.test(err.message),
    );
  });

  it("handles unicode in MAP values", () => {
    const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : api_call
    OPERATION op
    MAP channel = #日本語チャンネル
    MAP text = Привет мир 🚀
`;
    const result = parseDsl(dsl);
    assert.equal(
      result.workflows[0].steps[0].inputMapping!.channel,
      "#日本語チャンネル",
    );
    assert.equal(
      result.workflows[0].steps[0].inputMapping!.text,
      "Привет мир 🚀",
    );
  });

  it("handles large DSL without performance issues", () => {
    let dsl =
      "PROJECT perf-test\nDESCRIPTION test\nWORKFLOW w\n  DESCRIPTION test\n";
    for (let i = 0; i < 100; i++) {
      dsl += `  STEP step_${i} : transform\n    EXPRESSION ${i}\n`;
    }
    const start = Date.now();
    const result = parseDsl(dsl);
    const elapsed = Date.now() - start;
    assert.equal(result.workflows[0].steps.length, 100);
    // Should parse 100 steps well under 1 second
    assert.ok(elapsed < 1000, `Took ${elapsed}ms, expected < 1000ms`);
  });
});
