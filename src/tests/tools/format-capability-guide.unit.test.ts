import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatCapabilityGuide } from "../../tools/capability-guide.js";
import type { CompactEndpoint } from "../../parser/index.js";

function makeEndpoint(
  overrides: Partial<CompactEndpoint> = {},
): CompactEndpoint {
  return {
    operationId: "test-op",
    summary: "Test Endpoint",
    domain: "messaging" as CompactEndpoint["domain"],
    ...overrides,
  };
}

describe("formatCapabilityGuide", () => {
  it("returns 'No endpoints found.' for empty input", () => {
    const result = formatCapabilityGuide([]);
    assert.equal(result, "No endpoints found.");
  });

  it("groups endpoints by domain with summary → operationId format", () => {
    const endpoints = [
      makeEndpoint({
        domain: "messaging",
        summary: "Send Message",
        operationId: "post-api-v1-chat_sendMessage",
      }),
      makeEndpoint({
        domain: "messaging",
        summary: "Delete Message",
        operationId: "post-api-v1-chat_delete",
      }),
      makeEndpoint({
        domain: "rooms",
        summary: "Create Room",
        operationId: "post-api-v1-channels_create",
      }),
    ];
    const result = formatCapabilityGuide(endpoints);

    assert.ok(result.includes("## messaging"));
    assert.ok(result.includes("## rooms"));
    assert.ok(
      result.includes(
        "Send Message (needs rid (room ID, NOT user ID); supports tmid for threads; does NOT resolve @here, @all, @user mentions or #channel names \u2014 use postMessage if you need mention pings or channel-name lookup; to DM a user use postMessage with channel=@username instead) \u2192 post-api-v1-chat_sendMessage",
      ),
    );
    assert.ok(result.includes("Delete Message → post-api-v1-chat_delete"));
    assert.ok(result.includes("Create Room → post-api-v1-channels_create"));
  });

  it("does NOT include tag names in output", () => {
    const endpoints = [
      makeEndpoint({
        domain: "messaging",
        summary: "Send Message",
      }),
      makeEndpoint({ domain: "rooms", summary: "Create Room" }),
    ];
    const result = formatCapabilityGuide(endpoints);

    assert.ok(!result.includes("### Chat"));
    assert.ok(!result.includes("### Rooms"));
    assert.ok(!result.includes("**Chat**"));
    assert.ok(!result.includes("**Rooms**"));
  });

  it("deduplicates identical summaries within a domain (keeps first operationId)", () => {
    const endpoints = [
      makeEndpoint({
        domain: "messaging",
        summary: "Send Message",
        operationId: "op1",
      }),
      makeEndpoint({
        domain: "messaging",
        summary: "Send Message",
        operationId: "op2",
      }),
      makeEndpoint({
        domain: "messaging",
        summary: "Delete Message",
        operationId: "op3",
      }),
    ];
    const result = formatCapabilityGuide(endpoints);

    const count = result.split("Send Message").length - 1;
    assert.equal(count, 1, "Send Message should appear exactly once");
    assert.ok(result.includes("Send Message → op1"));
    assert.ok(!result.includes("Send Message → op2"));
  });

  it("keeps identical summaries in different domains", () => {
    const endpoints = [
      makeEndpoint({
        domain: "messaging",
        summary: "Create",
        operationId: "messaging-create",
      }),
      makeEndpoint({
        domain: "rooms",
        summary: "Create",
        operationId: "rooms-create",
      }),
    ];
    const result = formatCapabilityGuide(endpoints);

    assert.ok(result.includes("## messaging"));
    assert.ok(result.includes("Create \u2192 messaging-create"));
    assert.ok(result.includes("## rooms"));
    assert.ok(result.includes("Create \u2192 rooms-create"));
  });

  it("shows ALL endpoints (no truncation)", () => {
    const endpoints = Array.from({ length: 20 }, (_, i) =>
      makeEndpoint({
        domain: "messaging",
        summary: `Action ${i + 1}`,
        operationId: `op${i}`,
      }),
    );
    const result = formatCapabilityGuide(endpoints);

    assert.ok(result.includes("Action 1 → op0"));
    assert.ok(result.includes("Action 10 → op9"));
    assert.ok(result.includes("Action 20 → op19"));
    assert.ok(!result.includes("+"));
    assert.ok(!result.includes("more"));
  });

  it("does NOT append request body fields", () => {
    const endpoints = [
      makeEndpoint({
        domain: "messaging",
        summary: "Post Message",
        operationId: "post-api-v1-chat_postMessage",
      }),
      makeEndpoint({
        domain: "messaging",
        summary: "Delete Message",
        operationId: "post-api-v1-chat_delete",
      }),
    ];
    const result = formatCapabilityGuide(endpoints);
    assert.ok(
      result.includes(
        "Post Message (resolves #channel and @user names; processes @here/@all mentions; use when sending by channel name) → post-api-v1-chat_postMessage",
      ),
    );
    assert.ok(!result.includes("[channel, text"));
    assert.ok(result.includes("Delete Message → post-api-v1-chat_delete"));
  });

  it("includes guide header and footer", () => {
    const endpoints = [makeEndpoint()];
    const result = formatCapabilityGuide(endpoints);

    assert.ok(result.includes("Capability Guide"));
    assert.ok(result.includes("operationId"));
  });

  it("handles multiple domains", () => {
    const endpoints = [
      makeEndpoint({
        domain: "messaging",
        summary: "Send Message",
        operationId: "op1",
      }),
      makeEndpoint({
        domain: "rooms",
        summary: "Create Room",
        operationId: "op2",
      }),
      makeEndpoint({
        domain: "authentication",
        summary: "Login",
        operationId: "op3",
      }),
    ];
    const result = formatCapabilityGuide(endpoints);

    assert.ok(result.includes("## messaging"));
    assert.ok(result.includes("## rooms"));
    assert.ok(result.includes("## authentication"));
  });

  it("handles single endpoint correctly", () => {
    const endpoints = [
      makeEndpoint({
        domain: "rooms",
        summary: "Mute User",
        operationId: "post-api-v1-rooms_muteUser",
      }),
    ];
    const result = formatCapabilityGuide(endpoints);

    assert.ok(result.includes("## rooms"));
    assert.ok(result.includes("Mute User → post-api-v1-rooms_muteUser"));
  });

  it("merges endpoints within same domain", () => {
    const endpoints = [
      makeEndpoint({
        domain: "rooms",
        summary: "Create Channel",
        operationId: "op1",
      }),
      makeEndpoint({
        domain: "rooms",
        summary: "Create Room",
        operationId: "op2",
      }),
      makeEndpoint({
        domain: "rooms",
        summary: "Create Team",
        operationId: "op3",
      }),
    ];
    const result = formatCapabilityGuide(endpoints);

    const lines = result.split("\n");
    const roomsIdx = lines.findIndex((l) => l.startsWith("## rooms"));
    assert.ok(roomsIdx >= 0);
    const entriesLine = lines.slice(roomsIdx + 1).find((l) => l.includes("→"));
    assert.ok(entriesLine, "should have an entries line with →");
    assert.ok(entriesLine.includes("Create Channel → op1"));
    assert.ok(entriesLine.includes("Create Room → op2"));
    assert.ok(entriesLine.includes("Create Team → op3"));
  });

  it("annotates confusing endpoints with inline hints", () => {
    const endpoints = [
      makeEndpoint({
        domain: "messaging",
        summary: "Post Message",
        operationId: "post-api-v1-chat_postMessage",
      }),
      makeEndpoint({
        domain: "messaging",
        summary: "Search Message",
        operationId: "get-api-v1-chat_search",
      }),
      makeEndpoint({
        domain: "messaging",
        summary: "Delete Message",
        operationId: "post-api-v1-chat_delete",
      }),
    ];
    const result = formatCapabilityGuide(endpoints);

    assert.ok(
      result.includes(
        "Post Message (resolves #channel and @user names; processes @here/@all mentions; use when sending by channel name) → post-api-v1-chat_postMessage",
      ),
    );
    assert.ok(
      result.includes(
        "Search Message (searches message text content by keyword in a room) → get-api-v1-chat_search",
      ),
    );
    assert.ok(result.includes("Delete Message → post-api-v1-chat_delete"));
    assert.ok(!result.includes("Delete Message ("));
  });

  it("adds domain note at top of rooms section", () => {
    const endpoints = [
      makeEndpoint({
        domain: "rooms",
        summary: "Get Channel List",
        operationId: "get-api-v1-channels_list",
      }),
    ];
    const result = formatCapabilityGuide(endpoints);

    const lines = result.split("\n");
    const roomsIdx = lines.findIndex((l) => l.startsWith("## rooms"));
    assert.ok(roomsIdx >= 0);
    assert.ok(
      lines[roomsIdx + 1].includes("channels_* = public only"),
      "domain note should appear after ## rooms header",
    );
    assert.ok(
      lines[roomsIdx + 2].includes(
        "Get Channel List (all channels; sortable; full objects with _id) → get-api-v1-channels_list",
      ),
    );
  });

  it("does NOT add domain note for domains without one", () => {
    const endpoints = [
      makeEndpoint({
        domain: "messaging",
        summary: "Send Message",
        operationId: "post-api-v1-chat_sendMessage",
      }),
    ];
    const result = formatCapabilityGuide(endpoints);

    const lines = result.split("\n");
    const msgIdx = lines.findIndex((l) => l.startsWith("## messaging"));
    assert.ok(msgIdx >= 0);
    assert.ok(
      lines[msgIdx + 1].includes("→"),
      "messaging section should have entries immediately after header",
    );
  });
});
