import type { FullEndpoint, SpecParser } from "../parser/index.js";

// Output keys by parameter location.
const PARAMETER_GROUP_KEYS = {
  path: "pathParameters",
  query: "queryParameters",
  header: "headerParameters",
} as const;
const AUTH_HEADER_PARAMS = new Set(["X-Auth-Token", "X-User-Id"]);

type ParameterLocation = keyof typeof PARAMETER_GROUP_KEYS;

function buildParameterSchema(
  properties: Record<string, unknown> | undefined,
  parameters: FullEndpoint["parameters"],
  location: ParameterLocation,
) {
  if (!properties) return undefined;

  const groupedProperties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const param of parameters) {
    if (param.in !== location) continue;
    if (location === "header" && AUTH_HEADER_PARAMS.has(param.name)) continue;

    const schema = properties[param.name];
    if (!schema) continue;

    groupedProperties[param.name] = schema;
    if (param.required) required.push(param.name);
  }

  if (Object.keys(groupedProperties).length === 0) return undefined;

  return {
    type: "object",
    properties: groupedProperties,
    ...(required.length > 0 && { required }),
  };
}

export async function handleGetEndpointSchemas(
  parser: SpecParser,
  operationIds: string[],
) {
  try {
    const { endpoints, correctedIds } = await parser.getFullEndpoints(
      operationIds,
      undefined,
      5,
    );

    const schemas: Record<string, Record<string, unknown>> = {};
    for (const ep of endpoints) {
      const entry: Record<string, unknown> = {
        method: ep.method,
        path: ep.path,
      };
      const inputProperties = (ep.inputSchema as Record<string, unknown>)
        ?.properties as Record<string, unknown> | undefined;
      if (inputProperties?.requestBody) {
        entry.requestBody = inputProperties.requestBody;
      }

      for (const location of Object.keys(
        PARAMETER_GROUP_KEYS,
      ) as ParameterLocation[]) {
        const outputKey = PARAMETER_GROUP_KEYS[location];
        const parameterSchema = buildParameterSchema(
          inputProperties,
          ep.parameters,
          location,
        );
        if (parameterSchema) {
          entry[outputKey] = parameterSchema;
        }
      }
      if (ep.responseSchema) {
        entry.response = ep.responseSchema;
      }
      schemas[ep.operationId] = entry;
    }

    const matched = new Set(endpoints.map((e) => e.operationId));
    const unmatched = operationIds.filter(
      (id) => !matched.has(id) && !correctedIds.has(id),
    );

    const result: Record<string, unknown> = { endpoints: schemas };

    if (correctedIds.size > 0) {
      result.correctedOperationIds = Object.fromEntries(correctedIds);
    }
    if (unmatched.length > 0) {
      result.unmatchedOperationIds = unmatched;
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Failed to get endpoint schemas: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
}
