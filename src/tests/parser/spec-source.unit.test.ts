import { describe, it } from "node:test";
import assert from "node:assert/strict";
import SwaggerParser from "@apidevtools/swagger-parser";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenApiSpecSource } from "../../parser/index.js";
import type { OpenAPIV3 } from "openapi-types";

function makeSpec(summary: string): OpenAPIV3.Document {
  return {
    openapi: "3.0.0",
    info: { title: summary, version: "1.0.0" },
    paths: {
      "/api/v1/login": {
        post: {
          operationId: "post-api-v1-login",
          summary,
          responses: {
            "200": { description: "OK" },
          },
        },
      },
    },
  };
}

async function withPatchedDereference<T>(
  impl: () => Promise<unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const originalDereference = SwaggerParser.dereference;
  const swagger = SwaggerParser as unknown as {
    dereference: typeof SwaggerParser.dereference;
  };
  swagger.dereference = impl as typeof SwaggerParser.dereference;

  try {
    return await fn();
  } finally {
    swagger.dereference = originalDereference;
  }
}

describe("OpenApiSpecSource", () => {
  it("returns memory cached specs before fetching again", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "rc-mcp-gen-source-"));
    const networkSpec = makeSpec("from network");
    let fetchCount = 0;

    try {
      await withPatchedDereference(
        async () => {
          fetchCount += 1;
          if (fetchCount > 1) throw new Error("should use memory cache");
          return networkSpec;
        },
        async () => {
          const source = new OpenApiSpecSource({
            cacheDir,
            fallbackCacheDirs: [],
          });

          const first = await source.getSpec("authentication");
          const second = await source.getSpec("authentication");

          assert.equal(first, networkSpec);
          assert.equal(second, networkSpec);
          assert.equal(fetchCount, 1);
        },
      );
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("returns fresh disk cache without fetching from the network", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "rc-mcp-gen-source-"));
    const cachedSpec = makeSpec("from fresh disk");
    writeFileSync(
      join(cacheDir, "authentication.json"),
      JSON.stringify(cachedSpec),
      "utf-8",
    );

    try {
      await withPatchedDereference(
        async () => {
          throw new Error("should not fetch fresh cache");
        },
        async () => {
          const source = new OpenApiSpecSource({
            cacheDir,
            fallbackCacheDirs: [],
          });

          assert.deepStrictEqual(
            await source.getSpec("authentication"),
            cachedSpec,
          );
        },
      );
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("falls back to stale disk cache when fetching fails", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "rc-mcp-gen-source-"));
    const staleSpec = makeSpec("from stale disk");
    writeFileSync(
      join(cacheDir, "authentication.json"),
      JSON.stringify(staleSpec),
      "utf-8",
    );

    try {
      await withPatchedDereference(
        async () => {
          throw new Error("network unavailable");
        },
        async () => {
          const source = new OpenApiSpecSource({
            cacheDir,
            cacheTtlMs: -1,
            fallbackCacheDirs: [],
          });

          assert.deepStrictEqual(
            await source.getSpec("authentication"),
            staleSpec,
          );
        },
      );
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("ignores corrupt cache files and fetches from the network", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "rc-mcp-gen-source-"));
    const networkSpec = makeSpec("from network after corrupt cache");
    writeFileSync(join(cacheDir, "authentication.json"), "{", "utf-8");

    try {
      await withPatchedDereference(
        async () => networkSpec,
        async () => {
          const source = new OpenApiSpecSource({
            cacheDir,
            fallbackCacheDirs: [],
          });

          assert.equal(await source.getSpec("authentication"), networkSpec);
        },
      );
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("throws ParserError with the fetch failure as cause", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "rc-mcp-gen-source-"));
    const networkError = new Error("network unavailable");

    try {
      await withPatchedDereference(
        async () => {
          throw networkError;
        },
        async () => {
          const source = new OpenApiSpecSource({
            cacheDir,
            fallbackCacheDirs: [],
          });

          await assert.rejects(
            () => source.getSpec("authentication"),
            (err) =>
              err instanceof Error &&
              err.name === "ParserError" &&
              err.cause === networkError,
          );
        },
      );
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});
