import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleGetCapabilityGuide } from "../../tools/get-capability-guide.js";
import type { SpecParser } from "../../parser/index.js";
import type { Domain } from "../../parser/index.js";

describe("handleGetCapabilityGuide", () => {
  it("formats compact endpoints from all available domains", async () => {
    let requestedDomains: Domain[] | undefined;
    const parser = {
      getAvailableDomains: () => ["messaging" as Domain],
      listEndpoints: async (domains: Domain[]) => {
        requestedDomains = domains;
        return [
          {
            operationId: "post-api-v1-chat_postMessage",
            summary: "Post Message",
            domain: "messaging" as Domain,
          },
        ];
      },
    } as unknown as SpecParser;

    const result = await handleGetCapabilityGuide(parser);

    assert.deepStrictEqual(requestedDomains, ["messaging"]);
    assert.equal(result.isError, undefined);
    assert.equal(result.content[0].type, "text");
    assert.ok(
      result.content[0].text.includes(
        "Post Message (resolves #channel and @user names; processes @here/@all mentions; use when sending by channel name) → post-api-v1-chat_postMessage",
      ),
    );
  });

  it("returns an error response with available domains when parsing fails", async () => {
    const parser = {
      getAvailableDomains: () => ["messaging" as Domain, "rooms" as Domain],
      listEndpoints: async () => {
        throw new Error("spec unavailable");
      },
    } as unknown as SpecParser;

    const result = await handleGetCapabilityGuide(parser);

    assert.equal(result.isError, true);
    assert.equal(result.content[0].type, "text");
    assert.ok(
      result.content[0].text.includes(
        "Failed to generate capability guide: spec unavailable",
      ),
    );
    assert.ok(
      result.content[0].text.includes("Available domains: messaging, rooms"),
    );
  });
});
