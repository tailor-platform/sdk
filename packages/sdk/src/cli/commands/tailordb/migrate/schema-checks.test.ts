import { afterEach, describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { logRemoteDriftGuidance } from "./schema-checks";
import { MISSING_REMOTE_SCRIPT_HASH_SUFFIX } from "./snapshot";
import type { SchemaDrift } from "./types";

const missingHashDrift: SchemaDrift = {
  tableName: "Foo",
  kind: "script_mismatch",
  details: `Table 'Foo' ${MISSING_REMOTE_SCRIPT_HASH_SUFFIX}`,
};

const scriptsDifferDrift: SchemaDrift = {
  tableName: "Bar",
  kind: "script_mismatch",
  details: "Table 'Bar' scripts differ between remote and snapshot",
};

const conflictingHashDrift: SchemaDrift = {
  tableName: "Baz",
  kind: "script_mismatch",
  details: "Table 'Baz' has conflicting script hashes on remote",
};

function hintWasLogged(infoSpy: ReturnType<typeof vi.spyOn>): boolean {
  return (infoSpy.mock.calls as unknown[][]).some(
    ([message]) => typeof message === "string" && message.includes("add the missing hashes"),
  );
}

describe("logRemoteDriftGuidance", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("adds the missing-hash hint when every drift is a missing script hash", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance([{ hasDrift: true, drifts: [missingHashDrift] }]);
    expect(hintWasLogged(infoSpy)).toBe(true);
  });

  test("omits the hint when a drift is not a missing script hash", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance([{ hasDrift: true, drifts: [missingHashDrift, scriptsDifferDrift] }]);
    expect(hintWasLogged(infoSpy)).toBe(false);
  });

  test("omits the hint when no drift results are passed", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance();
    expect(hintWasLogged(infoSpy)).toBe(false);
  });

  test("omits the hint when only one of several namespaces has a non-missing-hash drift", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance([
      { hasDrift: true, drifts: [missingHashDrift] },
      { hasDrift: true, drifts: [scriptsDifferDrift] },
    ]);
    expect(hintWasLogged(infoSpy)).toBe(false);
  });

  test("shows the hint when namespaces without drift are ignored", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance([
      { hasDrift: true, drifts: [missingHashDrift] },
      { hasDrift: false, drifts: [] },
    ]);
    expect(hintWasLogged(infoSpy)).toBe(true);
  });

  test("omits the hint for a conflicting-hash drift, which is not the missing-hash pattern", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance([{ hasDrift: true, drifts: [conflictingHashDrift] }]);
    expect(hintWasLogged(infoSpy)).toBe(false);
  });
});
