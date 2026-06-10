import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpecParser, VALID_DOMAINS } from "../../parser/index.js";
import {
  DOMAIN_NOTES,
  ENDPOINT_ANNOTATIONS,
} from "../../tools/capability-guide.js";

describe("capability guide annotations", () => {
  it("reference operationIds that exist in the parsed Rocket.Chat specs", async () => {
    const parser = new SpecParser();
    const endpoints = await parser.listEndpoints(VALID_DOMAINS);
    const operationIds = new Set(
      endpoints.map((endpoint) => endpoint.operationId),
    );
    const missing = Object.keys(ENDPOINT_ANNOTATIONS).filter(
      (operationId) => !operationIds.has(operationId),
    );

    assert.deepStrictEqual(missing, []);
  });

  it("domain notes reference valid domains", () => {
    const validDomains = new Set<string>(VALID_DOMAINS);
    const invalidDomains = Object.keys(DOMAIN_NOTES).filter(
      (domain) => !validDomains.has(domain),
    );

    assert.deepStrictEqual(invalidDomains, []);
  });
});
