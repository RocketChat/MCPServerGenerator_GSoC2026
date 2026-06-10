import type { EndpointDetailSource } from "../parser/index.js";

const PARAMETER_GROUP_KEYS = {
  path: "pathParameters",
  query: "queryParameters",
  header: "headerParameters",
} as const;

type ParameterLocation = keyof typeof PARAMETER_GROUP_KEYS;

export async function handleGetEndpointSchemas(
  parser: EndpointDetailSource,
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
      if (ep.requestBody) {
        entry.requestBody = ep.requestBody.schema;
      }

      for (const location of Object.keys(
        PARAMETER_GROUP_KEYS,
      ) as ParameterLocation[]) {
        const parameterSchema = ep.parameterSchemas[location];
        if (parameterSchema) {
          entry[PARAMETER_GROUP_KEYS[location]] = parameterSchema;
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
      structuredContent: result,
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
