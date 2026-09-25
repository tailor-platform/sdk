import { afterEach, describe, expect, test } from "vitest";
import {
  beginWaitPointScope,
  getRegisteredWaitPoints,
  getScopedWaitPoints,
  registerWaitPoint,
  restoreWaitPointRegistry,
} from "./wait-point-registry";

// The registry is process-wide, so anything these tests declare has to go back
// before the next file runs its own deploy-time check.
const mark = getRegisteredWaitPoints().length;
afterEach(() => {
  restoreWaitPointRegistry(mark);
});

describe("wait point registry scope", () => {
  test("reports every registration when no scope was started", () => {
    registerWaitPoint({ key: "first-key", declaredBy: "createWaitPoint" });

    expect(getScopedWaitPoints()).toContainEqual({
      key: "first-key",
      declaredBy: "createWaitPoint",
    });
  });

  test("hides what an earlier run left behind", () => {
    registerWaitPoint({ key: "earlier-key", declaredBy: "createWaitPoint" });

    beginWaitPointScope();
    registerWaitPoint({ key: "later-key", declaredBy: "createWaitPoint" });

    expect(getScopedWaitPoints()).toEqual([{ key: "later-key", declaredBy: "createWaitPoint" }]);
    // The entry is only out of scope, not gone.
    expect(getRegisteredWaitPoints()).toContainEqual({
      key: "earlier-key",
      declaredBy: "createWaitPoint",
    });
  });

  test("keeps a scope empty until the run declares something", () => {
    registerWaitPoint({ key: "earlier-key", declaredBy: "createWaitPoint" });
    beginWaitPointScope();

    expect(getScopedWaitPoints()).toEqual([]);
  });
});
