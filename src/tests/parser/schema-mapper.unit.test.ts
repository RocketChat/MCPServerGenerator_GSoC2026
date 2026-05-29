import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapOpenApiSchemaToJsonSchema } from "../../parser/schema-mapper.js";
import type { OpenAPIV3 } from "openapi-types";

describe("mapOpenApiSchemaToJsonSchema", () => {
  it("maps string type", () => {
    const result = mapOpenApiSchemaToJsonSchema({
      type: "string",
    } as OpenAPIV3.SchemaObject);
    assert.deepStrictEqual(result, { type: "string" });
  });

  it("maps integer to number", () => {
    const result = mapOpenApiSchemaToJsonSchema({
      type: "integer",
    } as OpenAPIV3.SchemaObject);
    assert.deepStrictEqual(result, { type: "number" });
  });

  it("maps nullable string", () => {
    const result = mapOpenApiSchemaToJsonSchema({
      type: "string",
      nullable: true,
    } as OpenAPIV3.SchemaObject);
    assert.deepStrictEqual(result, { type: ["string", "null"] });
  });

  it("maps object with properties", () => {
    const result = mapOpenApiSchemaToJsonSchema({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
      required: ["name"],
    } as OpenAPIV3.SchemaObject);

    assert.equal(result.type, "object");
    assert.ok(result.properties);
    assert.deepStrictEqual(result.properties!["name"], { type: "string" });
    assert.deepStrictEqual(result.properties!["age"], { type: "number" });
    assert.deepStrictEqual(result.required, ["name"]);
  });

  it("maps array with items", () => {
    const result = mapOpenApiSchemaToJsonSchema({
      type: "array",
      items: { type: "string" },
    } as OpenAPIV3.SchemaObject);

    assert.equal(result.type, "array");
    assert.deepStrictEqual(result.items, { type: "string" });
  });

  it("handles enum", () => {
    const result = mapOpenApiSchemaToJsonSchema({
      type: "string",
      enum: ["a", "b", "c"],
    } as OpenAPIV3.SchemaObject);
    assert.deepStrictEqual(result.enum, ["a", "b", "c"]);
  });

  it("carries over default values", () => {
    const result = mapOpenApiSchemaToJsonSchema({
      type: "string",
      default: "general",
    } as OpenAPIV3.SchemaObject);

    assert.deepStrictEqual(result, { type: "string", default: "general" });
  });

  it("handles unresolved $ref gracefully", () => {
    const result = mapOpenApiSchemaToJsonSchema({
      $ref: "#/components/schemas/Missing",
    } as OpenAPIV3.ReferenceObject);
    assert.deepStrictEqual(result, { type: "object" });
  });

  it("handles boolean schemas defensively", () => {
    const result = mapOpenApiSchemaToJsonSchema(
      true as unknown as OpenAPIV3.SchemaObject,
    );
    assert.deepStrictEqual(result, { type: "object" });
  });

  it("handles cycle detection", () => {
    const obj: any = { type: "object", properties: {} };
    obj.properties.self = obj;
    const result = mapOpenApiSchemaToJsonSchema(obj);
    assert.equal(result.type, "object");
    assert.ok(result.properties);
    assert.deepStrictEqual(result.properties!["self"], { type: "object" });
  });

  it("carries over description", () => {
    const result = mapOpenApiSchemaToJsonSchema({
      type: "string",
      description: "A test field",
    } as OpenAPIV3.SchemaObject);
    assert.equal(result.description, "A test field");
  });

  it("handles oneOf", () => {
    const result = mapOpenApiSchemaToJsonSchema({
      oneOf: [{ type: "string" }, { type: "number" }],
    } as unknown as OpenAPIV3.SchemaObject);
    assert.ok(result.oneOf);
    assert.equal(result.oneOf!.length, 2);
  });

  it("applies maxDepth to array items", () => {
    const result = mapOpenApiSchemaToJsonSchema(
      {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
          },
        },
      } as OpenAPIV3.SchemaObject,
      undefined,
      1,
    );

    assert.equal(result.type, "array");
    assert.deepStrictEqual(result.items, { type: "object" });
  });

  it("oneOf/anyOf/allOf do not consume depth budget", () => {
    const schema: OpenAPIV3.SchemaObject = {
      type: "object",
      oneOf: [
        {
          type: "object",
          properties: {
            roomId: { type: "string", description: "The channel ID" },
            userId: { type: "string", description: "The user ID" },
          },
          required: ["roomId", "userId"],
        } as OpenAPIV3.SchemaObject,
      ],
    } as unknown as OpenAPIV3.SchemaObject;

    const result = mapOpenApiSchemaToJsonSchema(schema, undefined, 2);
    assert.ok(result.oneOf, "oneOf should be present");
    const variant = result.oneOf![0] as Record<string, unknown>;
    const props = variant.properties as Record<string, Record<string, unknown>>;
    assert.ok(props, "variant should have properties");
    assert.equal(
      props.roomId.type,
      "string",
      "roomId should be string, not truncated to object",
    );
    assert.equal(
      props.roomId.description,
      "The channel ID",
      "roomId description preserved",
    );
    assert.equal(props.userId.type, "string", "userId should be string");

    const anyOfResult = mapOpenApiSchemaToJsonSchema(
      {
        anyOf: [{ type: "object", properties: { x: { type: "number" } } }],
      } as unknown as OpenAPIV3.SchemaObject,
      undefined,
      2,
    );
    assert.equal(
      ((anyOfResult.anyOf![0] as any).properties.x as any).type,
      "number",
      "anyOf should not consume depth",
    );

    const allOfResult = mapOpenApiSchemaToJsonSchema(
      {
        allOf: [{ type: "object", properties: { y: { type: "boolean" } } }],
      } as unknown as OpenAPIV3.SchemaObject,
      undefined,
      2,
    );
    assert.equal(
      ((allOfResult.allOf![0] as any).properties.y as any).type,
      "boolean",
      "allOf should not consume depth",
    );
  });
});
