import { describe, expect, test, vi } from "vitest";
import {
  decodeExpiresAt,
  encodeExpiresAt,
  expiresAtLabelKey,
  fetchWorkspaceExpiry,
  readWorkspaceExpiry,
  workspaceTrn,
} from "./expiry";

const NOW = new Date("2026-09-07T12:00:00Z");

describe("workspaceTrn", () => {
  test("addresses the workspace itself, without a resource segment", () => {
    expect(workspaceTrn("9cbd2f25-d293-459b-856e-6132844383d8")).toBe(
      "trn:v1:workspace:9cbd2f25-d293-459b-856e-6132844383d8",
    );
  });
});

describe("encodeExpiresAt", () => {
  test("produces a value the platform's label constraint accepts", () => {
    const value = encodeExpiresAt(NOW);

    expect(value).toBe("s-1788782400");
    expect(value).toMatch(/^$|^[a-z][a-z0-9_-]{0,62}$/);
  });

  test("round-trips through decodeExpiresAt at second resolution", () => {
    expect(decodeExpiresAt(encodeExpiresAt(NOW))).toEqual(NOW);
  });

  test("truncates sub-second precision down, never past the recorded expiry", () => {
    const value = encodeExpiresAt(new Date(NOW.getTime() + 999));

    expect(decodeExpiresAt(value)).toEqual(NOW);
  });
});

describe("decodeExpiresAt", () => {
  test.for([
    ["absent", undefined],
    ["empty", ""],
    ["unprefixed epoch", "1788782400"],
    ["an ISO timestamp", "2026-09-07t12-00-00z"],
    ["a wrong prefix", "x-1788782400"],
    ["a non-numeric payload", "s-later"],
    ["a payload beyond the safe integer range", "s-99999999999999999"],
  ])("rejects %s", ([, value]) => {
    expect(decodeExpiresAt(value)).toBeUndefined();
  });
});

describe("readWorkspaceExpiry", () => {
  test("reports an elapsed expiry as expired", () => {
    const labels = { [expiresAtLabelKey]: encodeExpiresAt(new Date(NOW.getTime() - 1000)) };

    expect(readWorkspaceExpiry(labels, NOW)).toEqual({
      state: "expired",
      expiresAt: new Date(NOW.getTime() - 1000),
    });
  });

  test("treats an expiry exactly at the reference time as expired", () => {
    const labels = { [expiresAtLabelKey]: encodeExpiresAt(NOW) };

    expect(readWorkspaceExpiry(labels, NOW)).toEqual({ state: "expired", expiresAt: NOW });
  });

  test("reports a future expiry as pending", () => {
    const labels = { [expiresAtLabelKey]: encodeExpiresAt(new Date(NOW.getTime() + 1000)) };

    expect(readWorkspaceExpiry(labels, NOW)).toEqual({
      state: "pending",
      expiresAt: new Date(NOW.getTime() + 1000),
    });
  });

  test.for([
    ["no labels at all", undefined],
    ["other labels only", { "sdk-name": "app" }],
    ["an empty value", { [expiresAtLabelKey]: "" }],
  ])("reports %s as unset", ([, labels]) => {
    expect(readWorkspaceExpiry(labels as Record<string, string> | undefined, NOW)).toEqual({
      state: "unset",
    });
  });

  test("reports a value this CLI could not have written as invalid", () => {
    expect(readWorkspaceExpiry({ [expiresAtLabelKey]: "yesterday" }, NOW)).toEqual({
      state: "invalid",
      value: "yesterday",
    });
  });
});

describe("fetchWorkspaceExpiry", () => {
  test("reads the expiry from the workspace's own TRN", async () => {
    const getMetadata = vi.fn().mockResolvedValue({
      metadata: {
        labels: { [expiresAtLabelKey]: encodeExpiresAt(new Date(NOW.getTime() - 1000)) },
      },
    });

    const result = await fetchWorkspaceExpiry({ getMetadata, setMetadata: vi.fn() }, "ws-1", NOW);

    expect(getMetadata).toHaveBeenCalledWith({ trn: "trn:v1:workspace:ws-1" });
    expect(result).toEqual({
      expiry: { state: "expired", expiresAt: new Date(NOW.getTime() - 1000) },
    });
  });

  test("reports a failed read as an error rather than an absent expiry", async () => {
    const getMetadata = vi.fn().mockRejectedValue(new Error("permission denied"));

    const result = await fetchWorkspaceExpiry({ getMetadata, setMetadata: vi.fn() }, "ws-1", NOW);

    expect(result).toEqual({ error: new Error("permission denied") });
    expect(result).not.toHaveProperty("expiry");
  });
});
