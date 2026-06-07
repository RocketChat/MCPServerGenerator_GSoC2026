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

export const INPUT_SCHEMA_BODY_KEY = "requestBody" as const;

export interface CompactEndpoint {
  operationId: string;
  summary: string;
  domain: Domain;
}

export interface EndpointParameterSchemas {
  path?: JSONSchema7;
  query?: JSONSchema7;
  header?: JSONSchema7;
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
  parameterSchemas: EndpointParameterSchemas;
}

export interface GetFullEndpointsResult {
  endpoints: FullEndpoint[];
  correctedIds: ReadonlyMap<string, string>;
}

export interface CapabilityGuideSource {
  getAvailableDomains(): Domain[];
  listEndpoints(domains: readonly Domain[]): Promise<CompactEndpoint[]>;
}

export interface EndpointDetailSource {
  getFullEndpoints(
    operationIds: string[],
    domains?: Domain[],
    maxDepth?: number,
  ): Promise<GetFullEndpointsResult>;
}

export interface SpecParserInterface
  extends CapabilityGuideSource, EndpointDetailSource {}

export interface SpecParserOptions {
  cacheDir?: string;
  cacheTtlMs?: number;
  fallbackCacheDirs?: string[];
  specSource?: SpecSource;
}

export interface SpecSource {
  getSpec(domain: Domain): Promise<OpenAPIV3.Document>;
}

export interface SpecSourceOptions {
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
