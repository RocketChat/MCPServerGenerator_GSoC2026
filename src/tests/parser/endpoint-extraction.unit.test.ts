import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractCompactEndpoints,
  extractFullEndpoints,
} from "../../parser/endpoint-extraction.js";
import type { OpenAPIV3 } from "openapi-types";

function makeSpec(paths: OpenAPIV3.PathsObject): OpenAPIV3.Document {
  return {
    openapi: "3.0.0",
    info: { title: "Test", version: "1.0.0" },
    paths,
  };
}

describe("extractCompactEndpoints", () => {
  it("generates sanitized fallback operationIds", () => {
    const spec = makeSpec({
      "/api/v1/users.info": {
        get: {
          responses: {},
        },
      },
    });

    const endpoints = extractCompactEndpoints(spec, "user-management");

    assert.deepStrictEqual(endpoints, [
      {
        operationId: "get__api_v1_users_info",
        summary: "GET /api/v1/users.info",
        domain: "user-management",
      },
    ]);
  });

  it("deduplicates repeated operationIds within a domain", () => {
    const spec = makeSpec({
      "/first": {
        get: {
          operationId: "duplicate",
          responses: {},
        },
      },
      "/second": {
        get: {
          operationId: "duplicate",
          responses: {},
        },
      },
    });

    const endpoints = extractCompactEndpoints(spec, "miscellaneous");

    assert.deepStrictEqual(
      endpoints.map((endpoint) => endpoint.operationId),
      ["duplicate", "duplicate_1"],
    );
  });

  it("falls back from summary to description to method and path", () => {
    const spec = makeSpec({
      "/described": {
        get: {
          description: "Description-only endpoint",
          responses: {},
        },
      },
      "/plain": {
        post: {
          responses: {},
        },
      },
    });

    const endpoints = extractCompactEndpoints(spec, "miscellaneous");

    assert.deepStrictEqual(
      endpoints.map((endpoint) => endpoint.summary),
      ["Description-only endpoint", "POST /plain"],
    );
  });
});

describe("extractFullEndpoints", () => {
  it("merges path parameters and lets operation parameters override duplicates", () => {
    const spec = makeSpec({
      "/rooms/{rid}": {
        parameters: [
          {
            name: "rid",
            in: "path",
            required: true,
            description: "Path-level rid",
            schema: { type: "string" },
          },
          {
            name: "count",
            in: "query",
            schema: { type: "integer" },
          },
        ],
        get: {
          operationId: "get-room",
          parameters: [
            {
              name: "count",
              in: "query",
              description: "Operation-level count",
              schema: { type: "integer" },
            },
          ],
          responses: {},
        },
      },
    });

    const [endpoint] = extractFullEndpoints(
      spec,
      "rooms",
      new Set(["get-room"]),
    );

    assert.equal(endpoint.parameters.length, 2);
    assert.equal(
      endpoint.parameters.find((param) => param.name === "count")?.description,
      "Operation-level count",
    );
    assert.deepStrictEqual(endpoint.inputSchema.required, ["rid"]);
  });

  it("filters unresolved parameter references", () => {
    const spec = makeSpec({
      "/rooms": {
        get: {
          operationId: "get-rooms",
          parameters: [
            { $ref: "#/components/parameters/AuthToken" },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer" },
            },
          ],
          responses: {},
        },
      },
    });

    const [endpoint] = extractFullEndpoints(
      spec,
      "rooms",
      new Set(["get-rooms"]),
    );

    assert.deepStrictEqual(
      endpoint.parameters.map((param) => param.name),
      ["offset"],
    );
  });

  it("strips auth headers from inputSchema but keeps them in parameters", () => {
    const spec = makeSpec({
      "/channels": {
        get: {
          operationId: "get-channels",
          parameters: [
            {
              name: "X-Auth-Token",
              in: "header",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "x-2fa-code",
              in: "header",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {},
        },
      },
    });

    const [endpoint] = extractFullEndpoints(
      spec,
      "rooms",
      new Set(["get-channels"]),
    );
    const properties = endpoint.inputSchema.properties as Record<
      string,
      unknown
    >;

    assert.ok(
      endpoint.parameters.some((param) => param.name === "X-Auth-Token"),
    );
    assert.equal(properties["X-Auth-Token"], undefined);
    assert.deepStrictEqual(endpoint.inputSchema.required, ["x-2fa-code"]);
  });

  it("extracts request body metadata and 201 response schemas", () => {
    const spec = makeSpec({
      "/channels": {
        post: {
          operationId: "create-channel",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                  },
                  required: ["name"],
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const [endpoint] = extractFullEndpoints(
      spec,
      "rooms",
      new Set(["create-channel"]),
    );

    assert.equal(endpoint.requestBody?.required, true);
    assert.deepStrictEqual(endpoint.inputSchema.required, ["requestBody"]);
    assert.deepStrictEqual(endpoint.responseSchema, {
      type: "object",
      properties: {
        success: { type: "boolean" },
      },
    });
  });

  it("uses global security unless operation security is provided", () => {
    const spec: OpenAPIV3.Document = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1.0.0" },
      security: [{ authToken: [] }],
      paths: {
        "/global": {
          get: {
            operationId: "global-security",
            responses: {},
          },
        },
        "/public": {
          get: {
            operationId: "public-operation",
            security: [],
            responses: {},
          },
        },
      },
    };

    const endpoints = extractFullEndpoints(
      spec,
      "miscellaneous",
      new Set(["global-security", "public-operation"]),
    );

    assert.deepStrictEqual(
      endpoints.find((endpoint) => endpoint.operationId === "global-security")
        ?.security,
      [{ authToken: [] }],
    );
    assert.deepStrictEqual(
      endpoints.find((endpoint) => endpoint.operationId === "public-operation")
        ?.security,
      [],
    );
  });
});
