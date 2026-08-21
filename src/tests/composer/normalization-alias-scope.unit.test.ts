import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { JSONSchema7 } from "json-schema";
import {
  normalizeEventParamShorthand,
  normalizeTemplateFields,
} from "../../composer/normalization.js";
import { ComposerError, type ComposeStepInput } from "../../composer/types.js";
import type { ApiCallStep } from "../../workflow/types.js";

function apiStep(
  id: string,
  config: Partial<ApiCallStep> & { inputMapping: Record<string, unknown> },
): ComposeStepInput {
  return {
    id,
    label: id,
    config: {
      type: "api_call",
      operationId: `op_${id}`,
      ...config,
    } as ApiCallStep,
  };
}

describe("normalizeTemplateFields - forEach alias scoping", () => {
  it("rewrites an alias reference inside the owning step's inputMapping", () => {
    const steps: ComposeStepInput[] = [
      apiStep("send", {
        forEach: "{{steps.list.channels}}",
        as: "ch",
        inputMapping: { roomId: "{{ch.name}}" },
      }),
    ];

    const warnings = normalizeTemplateFields(steps);

    const cfg = steps[0].config as ApiCallStep;
    assert.equal(cfg.inputMapping.roomId, "{{steps.ch.name}}");
    assert.ok(
      warnings.some((w) => w.code === "AS_VAR_REWRITTEN"),
      "expected an AS_VAR_REWRITTEN warning for the in-scope rewrite",
    );
  });

  it("throws when a non-owning step references the alias", () => {
    const steps: ComposeStepInput[] = [
      apiStep("send", {
        forEach: "{{steps.list.channels}}",
        as: "ch",
        inputMapping: { roomId: "{{ch.name}}" },
      }),
      apiStep("notify", {
        // "ch" is out of scope here — it belongs to the "send" loop.
        inputMapping: { text: "posted to {{ch.name}}" },
      }),
    ];

    assert.throws(
      () => normalizeTemplateFields(steps),
      (err: unknown) => {
        assert.ok(err instanceof ComposerError);
        assert.match(err.message, /forEach alias "ch"/);
        assert.match(err.message, /notify/);
        return true;
      },
    );
  });

  it("throws when the owning step uses its alias in the forEach collection expression", () => {
    const steps: ComposeStepInput[] = [
      apiStep("send", {
        // The alias does not exist yet while the collection is being resolved.
        forEach: "{{ch.items}}",
        as: "ch",
        inputMapping: { roomId: "static" },
      }),
    ];

    assert.throws(
      () => normalizeTemplateFields(steps),
      (err: unknown) =>
        err instanceof ComposerError && /forEach alias "ch"/.test(err.message),
    );
  });

  it("throws when a step references another loop's alias inside its own inputMapping", () => {
    const steps: ComposeStepInput[] = [
      apiStep("outer", {
        forEach: "{{steps.a.list}}",
        as: "outerItem",
        inputMapping: { id: "{{outerItem.id}}" },
      }),
      apiStep("inner", {
        forEach: "{{steps.b.list}}",
        as: "innerItem",
        // References "outerItem" which belongs to the "outer" step.
        inputMapping: { id: "{{innerItem.id}}", parent: "{{outerItem.id}}" },
      }),
    ];

    assert.throws(
      () => normalizeTemplateFields(steps),
      (err: unknown) =>
        err instanceof ComposerError &&
        /forEach alias "outerItem"/.test(err.message),
    );
  });

  it("leaves canonical steps.<alias> references untouched and does not throw", () => {
    const steps: ComposeStepInput[] = [
      apiStep("send", {
        forEach: "{{steps.list.channels}}",
        as: "ch",
        inputMapping: { roomId: "{{steps.ch.name}}" },
      }),
    ];

    const warnings = normalizeTemplateFields(steps);

    const cfg = steps[0].config as ApiCallStep;
    assert.equal(cfg.inputMapping.roomId, "{{steps.ch.name}}");
    assert.ok(!warnings.some((w) => w.code === "AS_VAR_REWRITTEN"));
  });

  it("scopes each alias independently so identical rewrites happen only in their own step", () => {
    const steps: ComposeStepInput[] = [
      apiStep("first", {
        forEach: "{{steps.a.rows}}",
        as: "row",
        inputMapping: { v: "{{row.value}}" },
      }),
      apiStep("second", {
        forEach: "{{steps.b.rows}}",
        as: "row",
        inputMapping: { v: "{{row.value}}" },
      }),
    ];

    const warnings = normalizeTemplateFields(steps);

    assert.equal(
      (steps[0].config as ApiCallStep).inputMapping.v,
      "{{steps.row.value}}",
    );
    assert.equal(
      (steps[1].config as ApiCallStep).inputMapping.v,
      "{{steps.row.value}}",
    );
    assert.equal(
      warnings.filter((w) => w.code === "AS_VAR_REWRITTEN").length,
      2,
    );
  });

  it("keeps alias precedence: an out-of-scope ref is never rescued into a param", () => {
    // A forEach alias intentionally shares its name with a workflow param.
    // The event-param normalizer must NOT rewrite the out-of-scope reference
    // into "params.channel.*"; it must remain an alias reference so the scope
    // check rejects it instead of silently resolving to an empty value.
    const params: JSONSchema7 = {
      type: "object",
      properties: { channel: { type: "object" } },
    };
    const steps: ComposeStepInput[] = [
      apiStep("loop", {
        forEach: "{{steps.list.channels}}",
        as: "channel",
        inputMapping: { roomId: "{{channel.id}}" },
      }),
      apiStep("after", {
        inputMapping: { roomId: "{{channel.id}}" },
      }),
    ];

    // Runs first in the pipeline; must leave the alias references untouched.
    normalizeEventParamShorthand(steps, params);
    assert.equal(
      (steps[1].config as ApiCallStep).inputMapping.roomId,
      "{{channel.id}}",
      "event-param normalizer must not rewrite an alias-named reference to params.*",
    );

    assert.throws(
      () => normalizeTemplateFields(steps),
      (err: unknown) =>
        err instanceof ComposerError &&
        /forEach alias "channel"/.test(err.message),
    );
  });
});
