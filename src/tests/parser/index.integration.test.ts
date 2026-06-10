import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ParserError, SpecParser, VALID_DOMAINS } from "../../parser/index.js";

const parser = new SpecParser();
const listEndpoints = parser.listEndpoints.bind(parser);
const getAvailableDomains = parser.getAvailableDomains.bind(parser);

describe("getAvailableDomains", () => {
  it("returns the configured domains", () => {
    const domains = getAvailableDomains();
    assert.deepStrictEqual(domains, VALID_DOMAINS);
  });

  it("returns a copy, not the original array", () => {
    const a = getAvailableDomains();
    const b = getAvailableDomains();
    assert.notEqual(a, b);
    assert.deepStrictEqual(a, b);
  });
});

describe("listEndpoints", () => {
  it("returns endpoints for authentication domain", async () => {
    const eps = await listEndpoints(["authentication"]);
    assert.ok(eps.length > 0, "should have endpoints");
    const login = eps.find((e) => e.operationId === "post-api-v1-login");
    assert.ok(login, "should have login endpoint");
    assert.equal(login!.domain, "authentication");
  });

  it("returns endpoints for messaging domain", async () => {
    const eps = await listEndpoints(["messaging"]);
    assert.ok(eps.length > 5, "messaging should have many endpoints");
    for (const ep of eps) {
      assert.equal(ep.domain, "messaging");
    }
  });

  it("returns endpoints from multiple domains", async () => {
    const eps = await listEndpoints(["authentication", "rooms"]);
    const domains = new Set(eps.map((e) => e.domain));
    assert.ok(domains.has("authentication"));
    assert.ok(domains.has("rooms"));
  });

  it("throws on invalid domain", async () => {
    await assert.rejects(
      () => listEndpoints(["nonexistent" as any]),
      (err) => err instanceof ParserError && /Invalid domain/.test(err.message),
    );
  });

  it("requires compact endpoints to include required fields", async () => {
    const eps = await listEndpoints(["authentication"]);
    for (const ep of eps) {
      assert.ok(ep.operationId, "should have operationId");
      assert.ok(ep.summary, "should have summary");
      assert.ok(ep.domain, "should have domain");
    }
  });

  it("keeps operationIds unique within a domain", async () => {
    const eps = await listEndpoints(["messaging"]);
    const ids = eps.map((e) => e.operationId);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, "operationIds should be unique");
  });
});

describe("all domains parse successfully", () => {
  for (const domain of VALID_DOMAINS) {
    it(`parses ${domain} domain`, async () => {
      const eps = await listEndpoints([domain]);
      assert.ok(eps.length > 0, `${domain} should have endpoints`);
      for (const ep of eps) {
        assert.equal(ep.domain, domain);
        assert.ok(ep.operationId);
        assert.ok(ep.summary);
      }
    });
  }
});
