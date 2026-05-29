import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleGetEndpointSchemas } from "../../tools/get-endpoint-schemas.js";
import type { SpecParser } from "../../parser/index.js";
import type { FullEndpoint } from "../../parser/index.js";

type EndpointParameter = FullEndpoint["parameters"][number];

function parseToolJson(
  result: Awaited<ReturnType<typeof handleGetEndpointSchemas>>,
) {
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

function makeParameter(
  name: string,
  location: EndpointParameter["in"],
  required = false,
): EndpointParameter {
  return {
    name,
    in: location,
    required,
    schema: { type: "string" },
  };
}

function makeEndpoint(overrides: Partial<FullEndpoint> = {}): FullEndpoint {
  return {
    operationId: "get-api-v1-channels_list",
    method: "GET",
    path: "/api/v1/channels.list",
    summary: "Get Channel List",
    description: "Get Channel List",
    domain: "rooms",
    parameters: [],
    security: [],
    inputSchema: {
      type: "object",
      properties: {
        offset: { type: "number" },
      },
    },
    ...overrides,
  };
}

describe("handleGetEndpointSchemas", () => {
  it("returns schemas with corrections and unmatched operationIds", async () => {
    const parser = {
      getFullEndpoints: async () => ({
        endpoints: [
          makeEndpoint({
            operationId: "get-api-v1-chat_getMessage",
            method: "GET",
            path: "/api/v1/chat.getMessage",
          }),
        ],
        correctedIds: new Map([
          ["get-api-v1-chat_getMessages", "get-api-v1-chat_getMessage"],
        ]),
      }),
    } as unknown as SpecParser;

    const result = await handleGetEndpointSchemas(parser, [
      "get-api-v1-chat_getMessages",
      "missing-id",
    ]);
    const json = parseToolJson(result);

    assert.equal(result.isError, undefined);
    assert.deepStrictEqual(json.correctedOperationIds, {
      "get-api-v1-chat_getMessages": "get-api-v1-chat_getMessage",
    });
    assert.deepStrictEqual(json.unmatchedOperationIds, ["missing-id"]);
    assert.ok(
      (json.endpoints as Record<string, unknown>)["get-api-v1-chat_getMessage"],
    );
  });

  it("returns requestBody schemas unchanged", async () => {
    const parser = {
      getFullEndpoints: async () => ({
        endpoints: [
          makeEndpoint({
            operationId: "post-api-v1-channels_create",
            method: "POST",
            path: "/api/v1/channels.create",
            inputSchema: {
              type: "object",
              properties: {
                requestBody: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    members: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          }),
        ],
        correctedIds: new Map<string, string>(),
      }),
    } as unknown as SpecParser;

    const result = await handleGetEndpointSchemas(parser, [
      "post-api-v1-channels_create",
    ]);
    const json = parseToolJson(result);
    const endpoints = json.endpoints as Record<string, Record<string, unknown>>;
    const channelCreate = endpoints["post-api-v1-channels_create"];
    const requestBody = channelCreate.requestBody as Record<string, unknown>;

    assert.deepStrictEqual(requestBody, {
      type: "object",
      properties: {
        name: { type: "string" },
        members: { type: "array", items: { type: "string" } },
      },
    });
  });

  it("returns requestBody and pathParameters for mixed endpoints", async () => {
    const parser = {
      getFullEndpoints: async () => ({
        endpoints: [
          makeEndpoint({
            operationId: "post-api-v1-rooms_mediaConfirm-rid-fileId",
            method: "POST",
            path: "/api/v1/rooms.mediaConfirm/{rid}/{fileId}",
            parameters: [
              makeParameter("rid", "path", true),
              makeParameter("fileId", "path", true),
            ],
            inputSchema: {
              type: "object",
              properties: {
                rid: { type: "string" },
                fileId: { type: "string" },
                requestBody: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                  },
                },
              },
            },
          }),
        ],
        correctedIds: new Map<string, string>(),
      }),
    } as unknown as SpecParser;

    const result = await handleGetEndpointSchemas(parser, [
      "post-api-v1-rooms_mediaConfirm-rid-fileId",
    ]);
    const json = parseToolJson(result);
    const endpoints = json.endpoints as Record<string, Record<string, unknown>>;
    const endpoint = endpoints["post-api-v1-rooms_mediaConfirm-rid-fileId"];
    const pathParameters = endpoint.pathParameters as {
      properties: Record<string, unknown>;
      required: string[];
    };

    assert.ok(endpoint.requestBody);
    assert.ok(pathParameters);
    assert.deepStrictEqual(Object.keys(pathParameters.properties), [
      "rid",
      "fileId",
    ]);
    assert.deepStrictEqual(pathParameters.required, ["rid", "fileId"]);
    assert.equal(endpoint.queryParameters, undefined);
  });

  it("returns true query params under queryParameters", async () => {
    const parser = {
      getFullEndpoints: async () => ({
        endpoints: [
          makeEndpoint({
            parameters: [makeParameter("offset", "query")],
            inputSchema: {
              type: "object",
              properties: {
                offset: { type: "number" },
              },
            },
          }),
        ],
        correctedIds: new Map<string, string>(),
      }),
    } as unknown as SpecParser;

    const result = await handleGetEndpointSchemas(parser, [
      "get-api-v1-channels_list",
    ]);
    const json = parseToolJson(result);
    const endpoints = json.endpoints as Record<string, Record<string, unknown>>;
    const endpoint = endpoints["get-api-v1-channels_list"];
    const queryParameters = endpoint.queryParameters as {
      properties: Record<string, unknown>;
    };

    assert.deepStrictEqual(queryParameters.properties.offset, {
      type: "number",
    });
    assert.equal(endpoint.pathParameters, undefined);
    assert.equal(endpoint.headerParameters, undefined);
  });

  it("returns non-auth header params under headerParameters", async () => {
    const parser = {
      getFullEndpoints: async () => ({
        endpoints: [
          makeEndpoint({
            parameters: [
              makeParameter("x-2fa-code", "header", true),
              makeParameter("X-Auth-Token", "header", true),
            ],
            inputSchema: {
              type: "object",
              properties: {
                "x-2fa-code": { type: "string" },
                "X-Auth-Token": { type: "string" },
              },
            },
          }),
        ],
        correctedIds: new Map<string, string>(),
      }),
    } as unknown as SpecParser;

    const result = await handleGetEndpointSchemas(parser, [
      "get-api-v1-channels_list",
    ]);
    const json = parseToolJson(result);
    const endpoints = json.endpoints as Record<string, Record<string, unknown>>;
    const endpoint = endpoints["get-api-v1-channels_list"];
    const headerParameters = endpoint.headerParameters as {
      properties: Record<string, unknown>;
      required: string[];
    };

    assert.deepStrictEqual(Object.keys(headerParameters.properties), [
      "x-2fa-code",
    ]);
    assert.deepStrictEqual(headerParameters.required, ["x-2fa-code"]);
  });

  it("returns an error response when schema lookup fails", async () => {
    const parser = {
      getFullEndpoints: async () => {
        throw new Error("lookup failed");
      },
    } as unknown as SpecParser;

    const result = await handleGetEndpointSchemas(parser, ["anything"]);

    assert.equal(result.isError, true);
    assert.ok(
      result.content[0].text.includes(
        "Failed to get endpoint schemas: lookup failed",
      ),
    );
  });
});
