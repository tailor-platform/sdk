import { describe, expect, test } from "vitest";
import {
  durationToSeconds,
  EXECUTION_POLICY_KEY_PATTERN,
  EXECUTION_POLICY_NAME_PATTERN,
  toPlatformExecutionPolicyKey,
} from "./workflow-policy";

describe("durationToSeconds", () => {
  test("converts each supported unit", () => {
    expect([
      durationToSeconds("500ms"),
      durationToSeconds("1s"),
      durationToSeconds("2m"),
      durationToSeconds("0s"),
    ]).toEqual([0.5, 1, 120, 0]);
  });

  test("returns null for a value that is not a duration", () => {
    expect([
      durationToSeconds("1sec"),
      durationToSeconds("1h"),
      durationToSeconds("-1s"),
      durationToSeconds("1.5s"),
      durationToSeconds(""),
    ]).toEqual([null, null, null, null, null]);
  });
});

describe("execution policy grammar", () => {
  test("accepts and rejects names at the length bounds", () => {
    expect([
      EXECUTION_POLICY_NAME_PATTERN.test("abc"),
      EXECUTION_POLICY_NAME_PATTERN.test("ab"),
      EXECUTION_POLICY_NAME_PATTERN.test("a".repeat(63)),
      EXECUTION_POLICY_NAME_PATTERN.test("a".repeat(64)),
      EXECUTION_POLICY_NAME_PATTERN.test("Premium"),
      EXECUTION_POLICY_NAME_PATTERN.test("tenant_api"),
    ]).toEqual([true, false, true, false, false, false]);
  });

  test("accepts and rejects keys at the length bounds", () => {
    expect([
      EXECUTION_POLICY_KEY_PATTERN.test("ab"),
      EXECUTION_POLICY_KEY_PATTERN.test("a"),
      EXECUTION_POLICY_KEY_PATTERN.test("b".repeat(64)),
      EXECUTION_POLICY_KEY_PATTERN.test("b".repeat(65)),
      EXECUTION_POLICY_KEY_PATTERN.test("tenant:api.v1"),
      EXECUTION_POLICY_KEY_PATTERN.test("tenant*"),
      EXECUTION_POLICY_KEY_PATTERN.test("tenant/api"),
    ]).toEqual([true, false, true, false, true, true, false]);
  });

  test("appends the wildcard only for prefix policies", () => {
    expect([
      toPlatformExecutionPolicyKey("tenant-api", "prefix"),
      toPlatformExecutionPolicyKey("tenant-api", "exact"),
    ]).toEqual(["tenant-api*", "tenant-api"]);
  });
});
