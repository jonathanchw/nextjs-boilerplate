import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextTitleHistoryAfterMark } from "./titleRotation.js";

describe("nextTitleHistoryAfterMark", () => {
  it("resets history to a single title when every title was already used", () => {
    const possible = ["A", "B", "C"];
    const history = ["A", "B", "C"];
    const next = nextTitleHistoryAfterMark("B", possible, history);
    assert.deepEqual(next, ["B"]);
  });

  it("appends a new title when rotation is incomplete", () => {
    const possible = ["A", "B", "C"];
    const history = ["A"];
    const next = nextTitleHistoryAfterMark("B", possible, history);
    assert.deepEqual(next, ["A", "B"]);
  });
});
