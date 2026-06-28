import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateExpression,
  evaluateCondition,
  resolveValue,
} from "../../workflow/templates.js";

const params = { name: "Ada", count: 3, ids: ["a", "b"] };
const steps = { first: { value: 42 } };

describe("expression sandbox security", () => {
  describe("known escape patterns are rejected", () => {
    const escapes: Array<[string, string]> = [
      ["constructor walk", "({}).constructor.constructor('return 1')()"],
      ["function constructor", "(function(){}).constructor('return process')()"],
      ["__proto__ access", "params.__proto__"],
      ["prototype access", "params.constructor.prototype"],
      ["process reference", "process.exit(1)"],
      ["global reference", "global.process"],
      ["globalThis reference", "globalThis.process"],
      ["require call", "require('fs')"],
      ["eval call", "eval('1+1')"],
      ["import call", "import('fs')"],
      ["this escape", "this.constructor.constructor('return this')()"],
    ];

    for (const [label, expr] of escapes) {
      it(`rejects ${label}`, () => {
        assert.throws(
          () => evaluateExpression(expr, params, steps),
          /Unsafe/,
          `expected "${expr}" to be rejected`,
        );
      });
    }
  });

  describe("safe expressions still evaluate", () => {
    it("reads params and steps", () => {
      assert.equal(evaluateExpression("params.name", params, steps), "Ada");
      assert.equal(evaluateExpression("steps.first.value", params, steps), 42);
    });

    it("exposes params as bare identifiers", () => {
      assert.equal(evaluateExpression("name", params, steps), "Ada");
    });

    it("allows approved array/string methods", () => {
      assert.deepEqual(
        evaluateExpression("ids.map((x) => x.toUpperCase())", params, steps),
        ["A", "B"],
      );
    });

    it("allows Math and JSON", () => {
      assert.equal(evaluateExpression("Math.max(1, count)", params, steps), 3);
      assert.equal(
        evaluateExpression("JSON.stringify({ a: 1 })", params, steps),
        '{"a":1}',
      );
    });
  });

  describe("evaluateCondition", () => {
    it("coerces to boolean", () => {
      assert.equal(evaluateCondition("count > 2", params, steps), true);
      assert.equal(evaluateCondition("count > 5", params, steps), false);
    });

    it("rejects unsafe conditions", () => {
      assert.throws(
        () => evaluateCondition("({}).constructor", params, steps),
        /Unsafe/,
      );
    });
  });

  describe("resolveValue type preservation", () => {
    it("keeps native type for a sole placeholder", () => {
      assert.equal(resolveValue("{{steps.first.value}}", params, steps), 42);
    });

    it("interpolates mixed strings", () => {
      assert.equal(
        resolveValue("Hello {{params.name}}!", params, steps),
        "Hello Ada!",
      );
    });

    it("recurses into objects and arrays", () => {
      assert.deepEqual(
        resolveValue({ who: "{{params.name}}", n: "{{params.count}}" }, params, steps),
        { who: "Ada", n: 3 },
      );
    });
  });
});
