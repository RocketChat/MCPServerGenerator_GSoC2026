import type { OpenAPIV3 } from "openapi-types";
import type { JSONSchema7 } from "json-schema";

export const VALID_DOMAINS = [
  "authentication",
  "messaging",
  "rooms",
  "user-management",
  "omnichannel",
  "integrations",
  "settings",
  "statistics",
  "notifications",
  "content-management",
  "marketplace-apps",
  "miscellaneous",
] as const;

export type Domain = (typeof VALID_DOMAINS)[number];

export interface CompactEndpoint {
  operationId: string;
  summary: string;
  domain: Domain;
}

export interface FullEndpoint {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  domain: Domain;
  parameters: OpenAPIV3.ParameterObject[];
  requestBody?: {
    contentType: string;
    schema: JSONSchema7;
    required: boolean;
  };
  responseSchema?: JSONSchema7;
  security: OpenAPIV3.SecurityRequirementObject[];
  inputSchema: JSONSchema7;
}

export interface GetFullEndpointsResult {
  endpoints: FullEndpoint[];
  correctedIds: ReadonlyMap<string, string>;
}

export interface SpecParserOptions {
  cacheDir?: string;
  cacheTtlMs?: number;
  fallbackCacheDirs?: string[];
}

export class ParserError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ParserError";
  }
}
