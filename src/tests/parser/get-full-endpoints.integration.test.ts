import { describe, it } from "node:test";
import assert from "node:assert/strict";
import SwaggerParser from "@apidevtools/swagger-parser";
import { SpecParser } from "../../parser/index.js";
import { extractFullEndpoints } from "../../parser/endpoint-extraction.js";
import type { OpenAPIV3 } from "openapi-types";

const parser = new SpecParser();
const listEndpoints = parser.listEndpoints.bind(parser);
const getFullEndpoints = parser.getFullEndpoints.bind(parser);

describe("getFullEndpoints", () => {
  it("returns full details for login endpoint", async () => {
    const { endpoints: eps } = await getFullEndpoints(["post-api-v1-login"]);
    assert.equal(eps.length, 1);
    const login = eps[0];
    assert.equal(login.operationId, "post-api-v1-login");
    assert.equal(login.method, "POST");
    assert.equal(login.path, "/api/v1/login");
    assert.ok(login.inputSchema, "should have inputSchema");
    assert.equal(login.inputSchema.type, "object");
  });

  it("returns full details for GET endpoint with query params", async () => {
    const { endpoints: eps } = await getFullEndpoints([
      "get-api-v1-channels_list",
    ]);
    assert.equal(eps.length, 1);
    const ep = eps[0];
    assert.equal(ep.method, "GET");
    const queryParams = ep.parameters.filter((p) => p.in === "query");
    assert.ok(queryParams.length > 0, "GET endpoint should have query params");
  });

  it("excludes auth headers from login inputSchema", async () => {
    const { endpoints: eps } = await getFullEndpoints(["post-api-v1-login"]);
    const schema = eps[0].inputSchema;
    const props = (schema as any).properties || {};
    assert.equal(
      props["X-Auth-Token"],
      undefined,
      "login should not require X-Auth-Token in schema",
    );
    assert.equal(
      props["X-User-Id"],
      undefined,
      "login should not require X-User-Id in schema",
    );
  });

  it("excludes auth headers from authenticated endpoint inputSchema", async () => {
    const { endpoints: eps } = await getFullEndpoints([
      "get-api-v1-channels_list",
    ]);
    const schema = eps[0].inputSchema;
    const props = (schema as any).properties || {};
    assert.equal(
      props["X-Auth-Token"],
      undefined,
      "auth header should be stripped from inputSchema",
    );
    assert.equal(
      props["X-User-Id"],
      undefined,
      "auth header should be stripped from inputSchema",
    );
  });

  it("keeps auth headers in authenticated endpoint parameters", async () => {
    const { endpoints: eps } = await getFullEndpoints([
      "get-api-v1-channels_list",
    ]);
    const authParam = eps[0].parameters.find(
      (p) => p.name === "X-Auth-Token" && p.in === "header",
    );
    assert.ok(
      authParam,
      "X-Auth-Token should still be in parameters for template use",
    );
  });

  it("returns empty array for unknown operationIds", async () => {
    const { endpoints: eps } = await getFullEndpoints([
      "nonexistent-endpoint-id",
    ]);
    assert.equal(eps.length, 0);
  });

  it("returns only requested endpoints (partial match)", async () => {
    const { endpoints: eps } = await getFullEndpoints([
      "post-api-v1-login",
      "nonexistent-id",
    ]);
    assert.equal(eps.length, 1);
    assert.equal(eps[0].operationId, "post-api-v1-login");
  });

  it("handles cross-domain endpoint requests", async () => {
    const { endpoints: eps } = await getFullEndpoints([
      "post-api-v1-login",
      "get-api-v1-channels_list",
    ]);
    assert.equal(eps.length, 2);
    const domains = new Set(eps.map((e) => e.domain));
    assert.ok(domains.size === 2, "should span multiple domains");
  });

  it("includes requestBody for POST endpoints", async () => {
    const { endpoints: eps } = await getFullEndpoints(["post-api-v1-login"]);
    assert.ok(eps[0].requestBody, "POST login should have requestBody");
    assert.equal(eps[0].requestBody!.contentType, "application/json");
  });

  it("resolves endpoints after domain index is populated by listEndpoints", async () => {
    await listEndpoints(["authentication"]);
    const { endpoints: eps } = await getFullEndpoints(["post-api-v1-login"]);
    assert.equal(eps.length, 1);
    assert.equal(eps[0].operationId, "post-api-v1-login");
    assert.equal(eps[0].domain, "authentication");
  });
});

describe("GET endpoint inputSchema includes query params", () => {
  it("includes roomId or roomName in channels.info inputSchema", async () => {
    const {
      endpoints: [ep],
    } = await getFullEndpoints(["get-api-v1-channels_info"]);
    assert.ok(ep, "channels.info endpoint should exist");
    assert.equal(ep.method, "GET");
    assert.equal(
      ep.requestBody,
      undefined,
      "GET endpoint should have no requestBody",
    );
    const props = (ep.inputSchema as any).properties;
    assert.ok(props, "inputSchema should have properties");
    const paramNames = Object.keys(props);
    assert.ok(
      paramNames.includes("roomId") || paramNames.includes("roomName"),
      `inputSchema should include roomId or roomName, got: ${paramNames.join(", ")}`,
    );
  });
});

describe("getFullEndpoints fuzzy matching", () => {
  it("resolves getMessage when given getMessages", async () => {
    const { endpoints } = await parser.getFullEndpoints([
      "get-api-v1-chat_getMessages",
    ]);
    const ids = endpoints.map((e) => e.operationId);
    assert.ok(
      ids.includes("get-api-v1-chat_getMessage"),
      `Expected getMessage in results, got: ${ids}`,
    );
  });

  it("records correction in the same getFullEndpoints result", async () => {
    const { correctedIds } = await parser.getFullEndpoints([
      "get-api-v1-chat_getMessages",
    ]);
    assert.strictEqual(
      correctedIds.get("get-api-v1-chat_getMessages"),
      "get-api-v1-chat_getMessage",
    );
  });

  it("does not fuzzy-match distant IDs", async () => {
    const { correctedIds } = await parser.getFullEndpoints([
      "get-api-v1-chat_deleteMessages",
    ]);
    assert.notStrictEqual(
      correctedIds.get("get-api-v1-chat_deleteMessages"),
      "get-api-v1-chat_getMessage",
    );
  });

  it("does not record corrections for exact matches", async () => {
    const { correctedIds } = await parser.getFullEndpoints([
      "get-api-v1-chat_getMessage",
    ]);
    assert.ok(!correctedIds.has("get-api-v1-chat_getMessage"));
  });

  it("records correction when exact and fuzzy IDs point to the same endpoint", async () => {
    const { endpoints, correctedIds } = await parser.getFullEndpoints([
      "get-api-v1-chat_getMessage",
      "get-api-v1-chat_getMessages",
    ]);

    assert.ok(
      endpoints.some((ep) => ep.operationId === "get-api-v1-chat_getMessage"),
    );
    assert.strictEqual(
      correctedIds.get("get-api-v1-chat_getMessages"),
      "get-api-v1-chat_getMessage",
    );
  });
});

describe("getFullEndpoints edge cases", () => {
  it("applies maxDepth to inputSchema requestBody", () => {
    const spec: OpenAPIV3.Document = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      paths: {
        "/test": {
          post: {
            operationId: "post-test",
            responses: {},
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      outer: {
                        type: "object",
                        properties: {
                          inner: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const [endpoint] = extractFullEndpoints(
      spec,
      "miscellaneous",
      new Set(["post-test"]),
      2,
    );
    const inputProperties = endpoint.inputSchema.properties as Record<
      string,
      any
    >;
    const requestBody = inputProperties.requestBody;
    const outer = requestBody.properties.outer;

    assert.deepStrictEqual(outer.properties.inner, { type: "object" });
  });

  it("returns empty result for empty operationIds without fetching specs", async () => {
    const originalDereference = SwaggerParser.dereference;
    const swagger = SwaggerParser as unknown as {
      dereference: typeof SwaggerParser.dereference;
    };
    swagger.dereference = async () => {
      throw new Error("should not fetch for empty operationIds");
    };

    try {
      const parser = new SpecParser({ fallbackCacheDirs: [] });
      const { endpoints, correctedIds } = await parser.getFullEndpoints([]);
      assert.deepStrictEqual(endpoints, []);
      assert.equal(correctedIds.size, 0);
    } finally {
      swagger.dereference = originalDereference;
    }
  });

  it("deduplicates repeated requested operationIds", async () => {
    const parser = new SpecParser();
    const { endpoints, correctedIds } = await parser.getFullEndpoints([
      "post-api-v1-login",
      "post-api-v1-login",
    ]);

    assert.equal(endpoints.length, 1);
    assert.equal(endpoints[0].operationId, "post-api-v1-login");
    assert.equal(correctedIds.size, 0);
  });

  it("respects explicit domain limits", async () => {
    const parser = new SpecParser();

    const wrongDomain = await parser.getFullEndpoints(
      ["post-api-v1-login"],
      ["messaging"],
    );
    assert.deepStrictEqual(wrongDomain.endpoints, []);

    const authDomain = await parser.getFullEndpoints(
      ["post-api-v1-login"],
      ["authentication"],
    );
    assert.equal(authDomain.endpoints.length, 1);
    assert.equal(authDomain.endpoints[0].domain, "authentication");
  });
});
