import { describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { logRemoteDriftGuidance } from "./schema-checks";
import type { SchemaDrift } from "./types";

const missingHashDrift: SchemaDrift = {
  tableName: "Foo",
  kind: "script_mismatch",
  details: "Table 'Foo' has no script hash on remote",
};

const scriptsDifferDrift: SchemaDrift = {
  tableName: "Bar",
  kind: "script_mismatch",
  details: "Table 'Bar' scripts differ between remote and snapshot",
};

function hintWasLogged(infoSpy: ReturnType<typeof vi.spyOn>): boolean {
  return (infoSpy.mock.calls as unknown[][]).some(
    ([message]) => typeof message === "string" && message.includes("pre-v2 CLI"),
  );
}

describe("logRemoteDriftGuidance", () => {
  test("adds the pre-v2 hint when every drift is a missing script hash", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance([{ hasDrift: true, drifts: [missingHashDrift] }]);
    expect(hintWasLogged(infoSpy)).toBe(true);
    infoSpy.mockRestore();
  });

  test("omits the hint when a drift is not a missing script hash", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance([{ hasDrift: true, drifts: [missingHashDrift, scriptsDifferDrift] }]);
    expect(hintWasLogged(infoSpy)).toBe(false);
    infoSpy.mockRestore();
  });

  test("omits the hint when no drift results are passed", () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    logRemoteDriftGuidance();
    expect(hintWasLogged(infoSpy)).toBe(false);
    infoSpy.mockRestore();
  });
});
