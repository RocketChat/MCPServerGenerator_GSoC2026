import type { OpenAPIV3 } from "openapi-types";
import type { JSONSchema7, JSONSchema7TypeName } from "json-schema";

export function mapOpenApiSchemaToJsonSchema(
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  seen: WeakSet<object> = new WeakSet(),
  maxDepth: number = Infinity,
  currentDepth: number = 0,
): JSONSchema7 {
  if (currentDepth >= maxDepth) {
    return { type: "object" };
  }

  if (typeof schema === "boolean") {
    return { type: "object" };
  }

  if ("$ref" in schema) {
    return { type: "object" };
  }

  if (seen.has(schema)) {
    return { type: "object" };
  }
  seen.add(schema);

  try {
    const jsonSchema: JSONSchema7 = {};

    if (schema.type) {
      jsonSchema.type =
        schema.type === "integer"
          ? "number"
          : (schema.type as JSONSchema7TypeName);
    }

    if (schema.description) {
      jsonSchema.description = schema.description;
    }

    if (schema.format) {
      jsonSchema.format = schema.format;
    }

    if (schema.nullable && typeof jsonSchema.type === "string") {
      jsonSchema.type = [jsonSchema.type as JSONSchema7TypeName, "null"];
    }

    if (schema.enum) {
      jsonSchema.enum = schema.enum;
    }

    if (schema.default !== undefined) {
      jsonSchema.default = schema.default;
    }

    if (schema.type === "object" && schema.properties) {
      jsonSchema.properties = {};
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (typeof propSchema === "object" && propSchema !== null) {
          jsonSchema.properties[key] = mapOpenApiSchemaToJsonSchema(
            propSchema as OpenAPIV3.SchemaObject,
            seen,
            maxDepth,
            currentDepth + 1,
          );
        }
      }
    }

    if (schema.required) {
      jsonSchema.required = schema.required;
    }

    if (schema.additionalProperties !== undefined) {
      jsonSchema.additionalProperties =
        typeof schema.additionalProperties === "object"
          ? mapOpenApiSchemaToJsonSchema(
              schema.additionalProperties as OpenAPIV3.SchemaObject,
              seen,
              maxDepth,
              currentDepth + 1,
            )
          : schema.additionalProperties;
    }

    if (
      schema.type === "array" &&
      typeof schema.items === "object" &&
      schema.items !== null
    ) {
      jsonSchema.items = mapOpenApiSchemaToJsonSchema(
        schema.items as OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
        seen,
        maxDepth,
        currentDepth + 1,
      );
    }

    if (schema.oneOf) {
      jsonSchema.oneOf = schema.oneOf.map((s) =>
        mapOpenApiSchemaToJsonSchema(
          s as OpenAPIV3.SchemaObject,
          seen,
          maxDepth,
          currentDepth,
        ),
      );
    }
    if (schema.anyOf) {
      jsonSchema.anyOf = schema.anyOf.map((s) =>
        mapOpenApiSchemaToJsonSchema(
          s as OpenAPIV3.SchemaObject,
          seen,
          maxDepth,
          currentDepth,
        ),
      );
    }
    if (schema.allOf) {
      jsonSchema.allOf = schema.allOf.map((s) =>
        mapOpenApiSchemaToJsonSchema(
          s as OpenAPIV3.SchemaObject,
          seen,
          maxDepth,
          currentDepth,
        ),
      );
    }

    return jsonSchema;
  } finally {
    seen.delete(schema);
  }
}
