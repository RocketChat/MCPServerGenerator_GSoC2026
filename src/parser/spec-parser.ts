import SwaggerParser from "@apidevtools/swagger-parser";
import { OpenAPIV3 } from "openapi-types";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  extractCompactEndpoints,
  extractFullEndpoints,
} from "./endpoint-extraction.js";
import type {
  CompactEndpoint,
  Domain,
  FullEndpoint,
  GetFullEndpointsResult,
  SpecParserOptions,
} from "./types.js";
import { ParserError, VALID_DOMAINS } from "./types.js";

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

// Used for operationId typo correction.
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[n];
}

export class SpecParser {
  private specCache = new Map<Domain, OpenAPIV3.Document>();
  private domainIndex = new Map<string, Domain>();
  private cacheDir: string;
  private cacheTtlMs: number;
  private fallbackCacheDirs: string[];

  constructor(options: SpecParserOptions = {}) {
    this.cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.fallbackCacheDirs = options.fallbackCacheDirs ?? [LEGACY_CACHE_DIR];
  }

  async listEndpoints(domains: readonly Domain[]): Promise<CompactEndpoint[]> {
    for (const domain of domains) {
      if (!VALID_DOMAINS.includes(domain)) {
        throw new ParserError(
          `Invalid domain: "${domain}". Valid domains: ${VALID_DOMAINS.join(", ")}`,
        );
      }
    }

    const specs = await Promise.all(domains.map((d) => this.getDomainSpec(d)));

    const requestedSet = new Set(domains);
    const results: CompactEndpoint[] = [];
    for (let i = 0; i < domains.length; i++) {
      const extracted = extractCompactEndpoints(specs[i], domains[i]);
      for (const ep of extracted)
        this.domainIndex.set(ep.operationId, ep.domain);
      if (requestedSet.has(domains[i])) results.push(...extracted);
    }

    return results;
  }

  async getFullEndpoints(
    operationIds: string[],
    domains?: Domain[],
    maxDepth?: number,
  ): Promise<GetFullEndpointsResult> {
    const correctedIds = new Map<string, string>();
    if (operationIds.length === 0) {
      return { endpoints: [], correctedIds };
    }

    let domainsToSearch: readonly Domain[];
    if (domains) {
      domainsToSearch = domains;
    } else if (this.domainIndex.size > 0) {
      const indexed = new Set<Domain>();
      let hasUnknown = false;
      for (const id of operationIds) {
        const d = this.domainIndex.get(id);
        if (d) indexed.add(d);
        else hasUnknown = true;
      }
      domainsToSearch = hasUnknown ? VALID_DOMAINS : [...indexed];
    } else {
      domainsToSearch = VALID_DOMAINS;
    }
    const idSet = new Set(operationIds);

    const specs = await Promise.all(
      domainsToSearch.map((d) => this.getDomainSpec(d)),
    );

    const results: FullEndpoint[] = [];
    const resultIds = new Set<string>();
    for (let i = 0; i < domainsToSearch.length; i++) {
      const extracted = extractFullEndpoints(
        specs[i],
        domainsToSearch[i],
        idSet,
        maxDepth,
      );
      results.push(...extracted);
      for (const ep of extracted) {
        idSet.delete(ep.operationId);
        resultIds.add(ep.operationId);
      }
      if (idSet.size === 0) break;
    }

    // Try relaxed operationId matching.
    if (idSet.size > 0) {
      const candidateIdsByDomain: string[][] = [];
      for (let i = 0; i < domainsToSearch.length; i++) {
        const compacts = extractCompactEndpoints(specs[i], domainsToSearch[i]);
        candidateIdsByDomain.push(compacts.map((c) => c.operationId));
      }

      const normalizeSeparators = (s: string) =>
        s.toLowerCase().replace(/[_-]/g, "-");
      const missingNorm = new Map<string, string>();
      for (const id of idSet) missingNorm.set(normalizeSeparators(id), id);

      const matchedIdsByDomain = new Map<Domain, Set<string>>();
      const fuzzyMatchedIds = new Set<string>();
      const addMatch = (
        domain: Domain,
        requestedId: string,
        actualId: string,
      ) => {
        if (resultIds.has(actualId) || fuzzyMatchedIds.has(actualId)) {
          if (requestedId !== actualId) correctedIds.set(requestedId, actualId);
          return;
        }
        let ids = matchedIdsByDomain.get(domain);
        if (!ids) {
          ids = new Set<string>();
          matchedIdsByDomain.set(domain, ids);
        }
        ids.add(actualId);
        fuzzyMatchedIds.add(actualId);
        if (requestedId !== actualId) correctedIds.set(requestedId, actualId);
      };

      for (let i = 0; i < domainsToSearch.length; i++) {
        if (missingNorm.size === 0) break;
        for (const candidateId of candidateIdsByDomain[i]) {
          const normId = normalizeSeparators(candidateId);
          if (missingNorm.has(normId)) {
            const origId = missingNorm.get(normId)!;
            addMatch(domainsToSearch[i], origId, candidateId);
            missingNorm.delete(normId);
          }
        }
      }

      if (missingNorm.size > 0) {
        const normalizeWithoutSeparators = (s: string) =>
          s.toLowerCase().replace(/[_-]/g, "");
        for (let i = 0; i < domainsToSearch.length; i++) {
          if (missingNorm.size === 0) break;
          for (const candidateId of candidateIdsByDomain[i]) {
            if (fuzzyMatchedIds.has(candidateId)) continue;
            const normCandidate = normalizeWithoutSeparators(candidateId);
            for (const [normReq, origReq] of missingNorm) {
              if (
                levenshtein(
                  normalizeWithoutSeparators(origReq),
                  normCandidate,
                ) <= 2
              ) {
                addMatch(domainsToSearch[i], origReq, candidateId);
                missingNorm.delete(normReq);
                break;
              }
            }
          }
        }
      }

      for (let i = 0; i < domainsToSearch.length; i++) {
        const ids = matchedIdsByDomain.get(domainsToSearch[i]);
        if (!ids?.size) continue;
        const extracted = extractFullEndpoints(
          specs[i],
          domainsToSearch[i],
          ids,
          maxDepth,
        );
        for (const ep of extracted) {
          if (resultIds.has(ep.operationId)) continue;
          results.push(ep);
          resultIds.add(ep.operationId);
        }
      }
    }

    return { endpoints: results, correctedIds };
  }

  getAvailableDomains(): Domain[] {
    return [...VALID_DOMAINS];
  }

  async getSpecStats(): Promise<{
    totalEndpoints: number;
    totalSchemaBytes: number;
  }> {
    const allEndpoints = await this.listEndpoints(VALID_DOMAINS);
    const specs = await Promise.all(
      VALID_DOMAINS.map((d) => this.getDomainSpec(d)),
    );
    const totalSchemaBytes = specs.reduce(
      (sum, spec) => sum + JSON.stringify(spec).length,
      0,
    );
    return { totalEndpoints: allEndpoints.length, totalSchemaBytes };
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
      // Cache writes are best effort; callers can still fetch specs next time.
    }
  }

  // Cache order: memory, fresh disk, network, stale disk.
  private async getDomainSpec(domain: Domain): Promise<OpenAPIV3.Document> {
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
