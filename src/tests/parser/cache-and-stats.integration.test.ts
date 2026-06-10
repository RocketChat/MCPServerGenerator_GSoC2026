import { describe, it } from "node:test";
import assert from "node:assert/strict";
import SwaggerParser from "@apidevtools/swagger-parser";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpecParser, VALID_DOMAINS } from "../../parser/index.js";
import type { OpenAPIV3 } from "openapi-types";

const parser = new SpecParser();
const listEndpoints = parser.listEndpoints.bind(parser);
const getSpecStats = parser.getSpecStats.bind(parser);

describe("stale cache fallback", () => {
  it("uses fresh disk cache without fetching from the network", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "rc-mcp-gen-cache-"));
    const cachedSpec: OpenAPIV3.Document = {
      openapi: "3.0.0",
      info: { title: "fresh auth", version: "1.0.0" },
      paths: {
        "/api/v1/login": {
          post: {
            operationId: "post-api-v1-login",
            summary: "Login from fresh cache",
            responses: {
              "200": { description: "OK" },
            },
          },
        },
      },
    };

    writeFileSync(
      join(cacheDir, "authentication.json"),
      JSON.stringify(cachedSpec),
      "utf-8",
    );

    const originalDereference = SwaggerParser.dereference;
    const swagger = SwaggerParser as unknown as {
      dereference: typeof SwaggerParser.dereference;
    };
    swagger.dereference = async () => {
      throw new Error("should not fetch fresh cache");
    };

    try {
      const cachedParser = new SpecParser({
        cacheDir,
        fallbackCacheDirs: [],
      });
      const eps = await cachedParser.listEndpoints(["authentication"]);
      assert.deepStrictEqual(eps, [
        {
          operationId: "post-api-v1-login",
          summary: "Login from fresh cache",
          domain: "authentication",
        },
      ]);
    } finally {
      swagger.dereference = originalDereference;
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("uses expired disk cache when fetching the spec fails", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "rc-mcp-gen-cache-"));
    const staleSpec: OpenAPIV3.Document = {
      openapi: "3.0.0",
      info: { title: "stale auth", version: "1.0.0" },
      paths: {
        "/api/v1/login": {
          post: {
            operationId: "post-api-v1-login",
            summary: "Login from stale cache",
            responses: {
              "200": { description: "OK" },
            },
          },
        },
      },
    };

    writeFileSync(
      join(cacheDir, "authentication.json"),
      JSON.stringify(staleSpec),
      "utf-8",
    );

    const originalDereference = SwaggerParser.dereference;
    const swagger = SwaggerParser as unknown as {
      dereference: typeof SwaggerParser.dereference;
    };
    swagger.dereference = async () => {
      throw new Error("network unavailable");
    };

    try {
      const staleParser = new SpecParser({
        cacheDir,
        cacheTtlMs: -1,
        fallbackCacheDirs: [],
      });
      const eps = await staleParser.listEndpoints(["authentication"]);
      assert.deepStrictEqual(eps, [
        {
          operationId: "post-api-v1-login",
          summary: "Login from stale cache",
          domain: "authentication",
        },
      ]);
    } finally {
      swagger.dereference = originalDereference;
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("ignores corrupt cache files and fetches from the network", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "rc-mcp-gen-cache-"));
    const networkSpec: OpenAPIV3.Document = {
      openapi: "3.0.0",
      info: { title: "network auth", version: "1.0.0" },
      paths: {
        "/api/v1/login": {
          post: {
            operationId: "post-api-v1-login",
            summary: "Login from network",
            responses: {
              "200": { description: "OK" },
            },
          },
        },
      },
    };

    writeFileSync(join(cacheDir, "authentication.json"), "{", "utf-8");

    const originalDereference = SwaggerParser.dereference;
    const swagger = SwaggerParser as unknown as {
      dereference: typeof SwaggerParser.dereference;
    };
    swagger.dereference = async () => networkSpec;

    try {
      const cachedParser = new SpecParser({
        cacheDir,
        fallbackCacheDirs: [],
      });
      const eps = await cachedParser.listEndpoints(["authentication"]);
      assert.deepStrictEqual(eps, [
        {
          operationId: "post-api-v1-login",
          summary: "Login from network",
          domain: "authentication",
        },
      ]);
    } finally {
      swagger.dereference = originalDereference;
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("preserves fetch failures as ParserError cause", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "rc-mcp-gen-cache-"));
    const originalDereference = SwaggerParser.dereference;
    const networkError = new Error("network unavailable");
    const swagger = SwaggerParser as unknown as {
      dereference: typeof SwaggerParser.dereference;
    };
    swagger.dereference = async () => {
      throw networkError;
    };

    try {
      const parser = new SpecParser({
        cacheDir,
        fallbackCacheDirs: [],
      });
      await assert.rejects(
        () => parser.listEndpoints(["authentication"]),
        (err) =>
          err instanceof Error &&
          err.name === "ParserError" &&
          err.cause === networkError,
      );
    } finally {
      swagger.dereference = originalDereference;
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});

describe("getSpecStats", () => {
  it("returns totalEndpoints > 0", async () => {
    const stats = await getSpecStats();
    assert.ok(stats.totalEndpoints > 100, "RC API should have 100+ endpoints");
  });

  it("returns totalSchemaBytes > 0", async () => {
    const stats = await getSpecStats();
    assert.ok(
      stats.totalSchemaBytes > 10_000,
      "total schema should be at least 10 KB",
    );
  });

  it("matches totalEndpoints to listEndpoints(all domains)", async () => {
    const stats = await getSpecStats();
    const all = await listEndpoints(VALID_DOMAINS);
    assert.equal(stats.totalEndpoints, all.length);
  });
});
