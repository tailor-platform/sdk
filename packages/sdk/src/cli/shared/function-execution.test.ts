import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  FunctionExecution_Status,
  FunctionLogEntrySchema,
  FunctionLogSeverity,
} from "@tailor-platform/tailor-proto/function_resource_pb";
import { describe, expect, test } from "vitest";
import {
  formatFunctionLogEntry,
  functionExecutionStatusToString,
  functionLogSeverityToString,
  isFunctionExecutionTerminalStatus,
  toFunctionLogEntryInfo,
} from "./function-execution";
import { stripAnsi } from "./test-helpers/strip-ansi";

describe("functionExecutionStatusToString", () => {
  test.each([
    [FunctionExecution_Status.UNSPECIFIED, "UNSPECIFIED"],
    [FunctionExecution_Status.RUNNING, "RUNNING"],
    [FunctionExecution_Status.SUCCESS, "SUCCESS"],
    [FunctionExecution_Status.FAILED, "FAILED"],
    [FunctionExecution_Status.SUSPEND, "SUSPEND"],
    [FunctionExecution_Status.CANCELING, "CANCELING"],
    [FunctionExecution_Status.CANCELED, "CANCELED"],
  ])("converts %s to %s", (status, expected) => {
    expect(functionExecutionStatusToString(status)).toBe(expected);
  });
});

describe("isFunctionExecutionTerminalStatus", () => {
  test.each([
    [FunctionExecution_Status.UNSPECIFIED, false],
    [FunctionExecution_Status.RUNNING, false],
    [FunctionExecution_Status.SUSPEND, false],
    [FunctionExecution_Status.CANCELING, false],
    [FunctionExecution_Status.SUCCESS, true],
    [FunctionExecution_Status.FAILED, true],
    [FunctionExecution_Status.CANCELED, true],
  ])("classifies %s as terminal=%s", (status, expected) => {
    expect(isFunctionExecutionTerminalStatus(status)).toBe(expected);
  });
});

describe("functionLogSeverityToString", () => {
  test.each([
    [FunctionLogSeverity.UNSPECIFIED, "UNSPECIFIED"],
    [FunctionLogSeverity.LOG, "LOG"],
    [FunctionLogSeverity.DEBUG, "DEBUG"],
    [FunctionLogSeverity.INFO, "INFO"],
    [FunctionLogSeverity.WARNING, "WARNING"],
    [FunctionLogSeverity.ERROR, "ERROR"],
  ])("converts %s to %s", (severity, expected) => {
    expect(functionLogSeverityToString(severity)).toBe(expected);
  });
});

describe("toFunctionLogEntryInfo", () => {
  test("maps severity to a string and timestamp to a Date", () => {
    const at = new Date("2026-09-05T01:02:03.456Z");
    const entry = create(FunctionLogEntrySchema, {
      message: "hello",
      severity: FunctionLogSeverity.WARNING,
      timestamp: timestampFromDate(at),
    });

    expect(toFunctionLogEntryInfo(entry)).toEqual({
      message: "hello",
      severity: "WARNING",
      timestamp: at,
    });
  });

  test("uses null when the timestamp is absent", () => {
    const entry = create(FunctionLogEntrySchema, {
      message: "hello",
      severity: FunctionLogSeverity.INFO,
    });

    expect(toFunctionLogEntryInfo(entry).timestamp).toBeNull();
  });
});

describe("formatFunctionLogEntry", () => {
  test("renders ISO timestamp, severity, and message", () => {
    const line = formatFunctionLogEntry({
      message: "boom",
      severity: "ERROR",
      timestamp: new Date("2026-09-05T01:02:03.456Z"),
    });

    expect(stripAnsi(line)).toBe("2026-09-05T01:02:03.456Z [ERROR] boom");
  });

  test("renders N/A when the timestamp is unknown", () => {
    const line = formatFunctionLogEntry({ message: "boom", severity: "LOG", timestamp: null });

    expect(stripAnsi(line)).toBe("N/A [LOG] boom");
  });
});
