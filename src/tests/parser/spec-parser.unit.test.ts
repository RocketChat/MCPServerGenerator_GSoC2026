import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpecParser } from "../../parser/index.js";
import type { Domain, SpecSource } from "../../parser/index.js";
import type { OpenAPIV3 } from "openapi-types";

function makeSpec(): OpenAPIV3.Document {
  return {
    openapi: "3.0.0",
    info: { title: "Injected", version: "1.0.0" },
    paths: {
      "/api/v1/login": {
        post: {
          operationId: "post-api-v1-login",
          summary: "Injected login",
          responses: {
            "200": { description: "OK" },
          },
        },
      },
    },
  };
}

describe("SpecParser", () => {
  it("uses an injected SpecSource", async () => {
    const requestedDomains: Domain[] = [];
    const specSource: SpecSource = {
      async getSpec(domain) {
        requestedDomains.push(domain);
        return makeSpec();
      },
    };

    const parser = new SpecParser({ specSource });
    const endpoints = await parser.listEndpoints(["authentication"]);

    assert.deepStrictEqual(requestedDomains, ["authentication"]);
    assert.deepStrictEqual(endpoints, [
      {
        operationId: "post-api-v1-login",
        summary: "Injected login",
        domain: "authentication",
      },
    ]);
  });

  it("fetches only the requested domains in listEndpoints", async () => {
    const requestedDomains: Domain[] = [];
    const specSource: SpecSource = {
      async getSpec(domain) {
        requestedDomains.push(domain);
        return makeSpec();
      },
    };

    const parser = new SpecParser({ specSource });
    const endpoints = await parser.listEndpoints(["messaging"]);

    assert.deepStrictEqual(requestedDomains, ["messaging"]);
    assert.deepStrictEqual(endpoints, [
      {
        operationId: "post-api-v1-login",
        summary: "Injected login",
        domain: "messaging",
      },
    ]);
  });
});
