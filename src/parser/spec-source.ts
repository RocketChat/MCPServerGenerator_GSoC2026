import SwaggerParser from "@apidevtools/swagger-parser";
import { OpenAPIV3 } from "openapi-types";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ParserError } from "./types.js";
import type { Domain, SpecSource, SpecSourceOptions } from "./types.js";

const SPEC_BASE_URL =
  "https://raw.githubusercontent.com/RocketChat/Rocket.Chat-Open-API/main";

const DEFAULT_CACHE_DIR = join(
  process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
  "rc-mcp-gen",
  "specs",
);
const LEGACY_CACHE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".cache",
);
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class OpenApiSpecSource implements SpecSource {
  private specCache = new Map<Domain, OpenAPIV3.Document>();
  private cacheDir: string;
  private cacheTtlMs: number;
  private fallbackCacheDirs: string[];

  constructor(options: SpecSourceOptions = {}) {
    this.cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.fallbackCacheDirs = options.fallbackCacheDirs ?? [LEGACY_CACHE_DIR];
  }

  // Cache order: memory, fresh disk, network, stale disk.
  async getSpec(domain: Domain): Promise<OpenAPIV3.Document> {
    const memCached = this.specCache.get(domain);
    if (memCached) return memCached;

    const diskCached = this.readDiskCache(domain);
    if (diskCached) {
      this.specCache.set(domain, diskCached);
      return diskCached;
    }

    const url = this.getSpecUrl(domain);
    let api: OpenAPIV3.Document;
    try {
      api = (await SwaggerParser.dereference(url)) as OpenAPIV3.Document;
    } catch (err) {
      const stale = this.readStaleDiskCache(domain);
      if (stale) {
        this.specCache.set(domain, stale);
        return stale;
      }

      const msg = err instanceof Error ? err.message : String(err);
      throw new ParserError(
        `Failed to fetch OpenAPI spec for "${domain}" from GitHub.\n` +
          `URL: ${url}\n` +
          `Cause: ${msg}\n\n` +
          `Check your network connection, or try again later if GitHub is down.`,
        { cause: err },
      );
    }
    this.specCache.set(domain, api);
    this.writeDiskCache(domain, api);
    return api;
  }

  private getSpecUrl(domain: Domain): string {
    return `${SPEC_BASE_URL}/${domain}.yaml`;
  }

  private readDiskCache(domain: Domain): OpenAPIV3.Document | null {
    try {
      const cachePath = join(this.cacheDir, `${domain}.json`);
      if (!existsSync(cachePath)) return null;

      const age = Date.now() - statSync(cachePath).mtimeMs;
      if (age > this.cacheTtlMs) return null;

      return this.readCacheFile(cachePath);
    } catch {
      return null;
    }
  }

  private writeDiskCache(domain: Domain, api: OpenAPIV3.Document): void {
    try {
      mkdirSync(this.cacheDir, { recursive: true });
      writeFileSync(join(this.cacheDir, `${domain}.json`), JSON.stringify(api));
    } catch {
      // Best-effort caching: write failures are non-fatal.
    }
  }

  private readStaleDiskCache(domain: Domain): OpenAPIV3.Document | null {
    const cachePaths = [
      join(this.cacheDir, `${domain}.json`),
      ...this.fallbackCacheDirs.map((dir) => join(dir, `${domain}.json`)),
    ];

    for (const cachePath of cachePaths) {
      if (!existsSync(cachePath)) continue;
      const cached = this.readCacheFile(cachePath);
      if (cached) return cached;
    }
    return null;
  }

  private readCacheFile(cachePath: string): OpenAPIV3.Document | null {
    try {
      return JSON.parse(readFileSync(cachePath, "utf-8")) as OpenAPIV3.Document;
    } catch {
      return null;
    }
  }
}
