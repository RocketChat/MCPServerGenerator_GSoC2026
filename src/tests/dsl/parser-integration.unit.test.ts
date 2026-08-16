import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDsl } from "../../dsl/index.js";

describe("parseDsl – full integration examples", () => {
  it("parses the full kb_search example", () => {
    const dsl = `
PROJECT team-hub
DESCRIPTION Knowledge-base search via slash command and image moderation

WORKFLOW kb_search
  DESCRIPTION Search pinned and matched messages, AI-rank, confirm, reply


  STEP get_channels : api_call
    LABEL Fetch Top Channels
    OPERATION get-api-v1-channels_list
    MAP count = 5
    MAP sort = {"msgs": -1}

  STEP fetch_pinned : api_call
    LABEL Get Pinned Per Channel
    DEPENDS ON get_channels
    OPERATION get-api-v1-chat_getPinnedMessages
    FOR_EACH {{steps.get_channels.channels}}
    AS channel
    MAP roomId = {{channel._id}}
    MAP count = 20

  STEP search_msgs : api_call
    LABEL Search Per Channel
    DEPENDS ON get_channels
    OPERATION get-api-v1-chat_search
    FOR_EACH {{steps.get_channels.channels}}
    AS ch
    MAP roomId = {{ch._id}}
    MAP searchText = {{params.query}}
    MAP count = 10

  STEP merge : transform
    LABEL Merge All Results
    DEPENDS ON fetch_pinned search_msgs
    EXPRESSION <<<
      const pinned = (steps.fetch_pinned || []).flatMap(r => r?.messages || []);
      const searched = (steps.search_msgs || []).flatMap(r => r?.messages || []);
      return [...pinned, ...searched].map(m => ({ id: m._id, text: m.msg, author: m.u?.username, room: m.rid }))
    >>>

  STEP rank : sampling
    LABEL AI-Rank Results
    DEPENDS ON merge
    SYSTEM_PROMPT You are a knowledge-base search assistant. Rank results by relevance.
    PROMPT <<<
      Query: {{params.query}}
      Candidate messages:
      {{steps.merge}}
      Return JSON: { results: [{ id, text, author, room, score }], hasRelevant: boolean }
    >>>
    RESPONSE_FORMAT json
    MAX_TOKENS 2000

  STEP check_found : conditional
    LABEL Any Relevant?
    DEPENDS ON rank
    CONDITION steps.rank.hasRelevant === true
    THEN ask_format
    ELSE suggest_help

  STEP ask_format : elicitation
    LABEL Ask User Preferences
    DEPENDS ON check_found
    MESSAGE Found results. How should I present them?
    SCHEMA {"type":"object","properties":{"format":{"type":"string","enum":["brief","detailed"]},"maxResults":{"type":"number"}},"required":["format"]}
    ON_DECLINE skip_remaining

  STEP compile : sampling
    LABEL Compile Final Answer
    DEPENDS ON ask_format
    PROMPT <<<
      User wants a {{steps.ask_format.format ?? "brief"}} summary.
      Compile the top {{steps.ask_format.maxResults ?? 3}} results:
      {{steps.rank.results}}
    >>>

  STEP reply_thread : api_call
    LABEL Reply in Thread
    DEPENDS ON compile
    OPERATION post-api-v1-chat_sendMessage
    MAP message.rid = {{params.room.id}}
    MAP message.msg = {{steps.compile}}
    MAP message.tmid = {{params.threadId}}

  STEP log_search : api_call
    LABEL Log to Channel
    DEPENDS ON compile
    OPERATION post-api-v1-chat_postMessage
    MAP channel = #kb-activity
    MAP text = Search by @{{params.sender.username}}: {{params.query}}

  STEP save_state : transform
    LABEL Update History
    DEPENDS ON compile
    EXPRESSION ({ queries: [...(params.searchHistory?.queries || []).slice(-9), params.query] })

  STEP suggest_help : api_call
    LABEL Suggest Help
    DEPENDS ON check_found
    OPERATION post-api-v1-chat_sendMessage
    MAP message.rid = {{params.room.id}}
    MAP message.msg = No results for "{{params.query}}". Try #help.
    MAP message.tmid = {{params.threadId}}
`;
    const result = parseDsl(dsl);
    assert.equal(result.projectName, "team-hub");
    assert.equal(result.workflows.length, 1);

    const wf = result.workflows[0];
    assert.equal(wf.name, "kb_search");
    assert.equal(wf.steps.length, 12);

    const replyThread = wf.steps.find((s) => s.id === "reply_thread")!;
    assert.deepEqual(replyThread.inputMapping, {
      message: {
        rid: "{{params.room.id}}",
        msg: "{{steps.compile}}",
        tmid: "{{params.threadId}}",
      },
    });

    const fetchPinned = wf.steps.find((s) => s.id === "fetch_pinned")!;
    assert.equal(fetchPinned.forEach, "{{steps.get_channels.channels}}");
    assert.equal(fetchPinned.as, "channel");

    const checkFound = wf.steps.find((s) => s.id === "check_found")!;
    assert.equal(checkFound.thenStep, "ask_format");
    assert.equal(checkFound.elseStep, "suggest_help");

    const askFormat = wf.steps.find((s) => s.id === "ask_format")!;
    assert.ok(askFormat.requestedSchema);
    assert.equal(askFormat.onDecline, "skip_remaining");
  });

  it("step without optional fields leaves them undefined", () => {
    const dsl = `
PROJECT test
DESCRIPTION test
WORKFLOW w
  DESCRIPTION test
  STEP t : transform
    EXPRESSION 42
`;
    const result = parseDsl(dsl);
    const step = result.workflows[0].steps[0];
    assert.equal(step.label, undefined);
    assert.equal(step.dependsOn, undefined);
    assert.equal(step.operationId, undefined);
    assert.equal(step.inputMapping, undefined);
    assert.equal(step.outputPath, undefined);
    assert.equal(step.forEach, undefined);
    assert.equal(step.as, undefined);
    assert.equal(step.continueOnError, undefined);
  });
});
