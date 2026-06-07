import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveOperationId } from "../../utils/resolve-operation-id.js";

describe("resolveOperationId", () => {
  it("returns an exact match", () => {
    assert.deepStrictEqual(
      resolveOperationId("post-api-v1-login", ["post-api-v1-login"]),
      { matched: "post-api-v1-login", method: "exact" },
    );
  });

  it("returns a separator-normalized match", () => {
    assert.deepStrictEqual(
      resolveOperationId("post_api_v1_foo", ["post-api-v1-foo"]),
      { matched: "post-api-v1-foo", method: "normalized" },
    );
  });

  it("returns the closest fuzzy match", () => {
    assert.deepStrictEqual(
      resolveOperationId("get-api-v1-chat_getMessages", [
        "get-api-v1-chat_getMessage",
        "get-api-v1-chat_sendMessage",
      ]),
      {
        matched: "get-api-v1-chat_getMessage",
        method: "fuzzy",
        distance: 1,
      },
    );
  });

  it("does not fuzzy-match short operationIds", () => {
    assert.equal(resolveOperationId("get_dm", ["get_im"]), null);
  });

  it("returns null beyond the fuzzy threshold", () => {
    assert.equal(
      resolveOperationId("get-api-v1-chat_deleteMessages", [
        "get-api-v1-chat_getMessage",
      ]),
      null,
    );
  });

  it("returns null for empty candidates", () => {
    assert.equal(resolveOperationId("post-api-v1-login", []), null);
  });
});
