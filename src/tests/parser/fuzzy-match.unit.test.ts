import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveMissingOperationIds } from "../../parser/spec-parser.js";
import type { Domain } from "../../parser/index.js";
import type { OpenAPIV3 } from "openapi-types";

function makeSpec(operationId: string): OpenAPIV3.Document {
  return {
    openapi: "3.0.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {
      "/api/v1/chat.getMessage": {
        get: {
          operationId,
          summary: "Get a chat message",
          responses: {
            "200": { description: "OK" },
          },
        },
      },
    },
  };
}

describe("resolveMissingOperationIds", () => {
  it("returns full endpoints and corrections for fuzzy matches", () => {
    const result = resolveMissingOperationIds({
      missingIds: new Set(["get-api-v1-chat_getMessages"]),
      domainsToSearch: ["messaging"],
      specs: [makeSpec("get-api-v1-chat_getMessage")],
      resultIds: new Set(),
    });

    assert.deepStrictEqual(
      result.additionalEndpoints.map((endpoint) => endpoint.operationId),
      ["get-api-v1-chat_getMessage"],
    );
    assert.equal(
      result.correctedIds.get("get-api-v1-chat_getMessages"),
      "get-api-v1-chat_getMessage",
    );
  });

  it("records corrections without duplicating already resolved endpoints", () => {
    const resultIds = new Set(["get-api-v1-chat_getMessage"]);
    const result = resolveMissingOperationIds({
      missingIds: new Set(["get-api-v1-chat_getMessages"]),
      domainsToSearch: ["messaging"],
      specs: [makeSpec("get-api-v1-chat_getMessage")],
      resultIds,
    });

    assert.deepStrictEqual(result.additionalEndpoints, []);
    assert.equal(resultIds.size, 1);
    assert.equal(
      result.correctedIds.get("get-api-v1-chat_getMessages"),
      "get-api-v1-chat_getMessage",
    );
  });

  it("returns no endpoints or corrections when no match is found", () => {
    const result = resolveMissingOperationIds({
      missingIds: new Set(["get-api-v1-chat_deleteMessages"]),
      domainsToSearch: ["messaging"],
      specs: [makeSpec("get-api-v1-chat_getMessage")],
      resultIds: new Set(),
    });

    assert.deepStrictEqual(result.additionalEndpoints, []);
    assert.equal(result.correctedIds.size, 0);
  });

  it("searches domains in order and returns the first match", () => {
    const domains: Domain[] = ["authentication", "messaging"];
    const result = resolveMissingOperationIds({
      missingIds: new Set(["get-api-v1-chat_getMessages"]),
      domainsToSearch: domains,
      specs: [
        makeSpec("get-api-v1-chat_getMessage"),
        makeSpec("get-api-v1-chat_getMessages"),
      ],
      resultIds: new Set(),
    });

    assert.equal(result.additionalEndpoints[0].domain, "authentication");
    assert.equal(
      result.correctedIds.get("get-api-v1-chat_getMessages"),
      "get-api-v1-chat_getMessage",
    );
  });
});
