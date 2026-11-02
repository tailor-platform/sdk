import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { tempDir } from "#/cli/shared/test-helpers/temp-dir";
import {
  FAILURE_BACKOFF_MS,
  getBannerStatePath,
  inFailureBackoff,
  readBannerState,
  writeBannerState,
} from "./throttle";

const NOW = Date.parse("2026-10-29T10:00:00Z");

describe("getBannerStatePath", () => {
  test("lives next to the platform config", () => {
    expect(getBannerStatePath("/cfg")).toBe("/cfg/tailor-platform/notification-banner.json");
  });

  test("is undefined when there is no config directory", () => {
    expect(getBannerStatePath(undefined)).toBeUndefined();
  });
});

describe("readBannerState", () => {
  test("is undefined when the file does not exist", () => {
    using tmp = tempDir("banner-");
    expect(readBannerState(path.join(tmp.dir, "missing.json"))).toBeUndefined();
  });

  test("is undefined when the file is not valid state", () => {
    using tmp = tempDir("banner-");
    const file = path.join(tmp.dir, "state.json");
    fs.writeFileSync(file, "{not json");
    expect(readBannerState(file)).toBeUndefined();
    fs.writeFileSync(file, JSON.stringify({ version: 1, failedAt: 42 }));
    expect(readBannerState(file)).toBeUndefined();
  });

  test("round-trips what writeBannerState wrote, creating the directory", () => {
    using tmp = tempDir("banner-");
    const file = path.join(tmp.dir, "nested", "state.json");
    const state = { version: 1 as const, failedAt: new Date(NOW).toISOString() };
    writeBannerState(file, state);
    expect(readBannerState(file)).toEqual(state);
    expect(fs.readdirSync(path.dirname(file))).toEqual(["state.json"]);
  });

  test("tolerates extra keys written by a newer SDK", () => {
    using tmp = tempDir("banner-");
    const file = path.join(tmp.dir, "state.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, failedAt: new Date(NOW).toISOString(), extra: 1 }),
    );
    expect(readBannerState(file)).toEqual({ version: 1, failedAt: new Date(NOW).toISOString() });
  });
});

describe("inFailureBackoff", () => {
  test("is false with no state or no recorded failure", () => {
    expect(inFailureBackoff(undefined, NOW)).toBe(false);
    expect(inFailureBackoff({ version: 1 }, NOW)).toBe(false);
  });

  test("is true for a short while after a failed lookup and false once it has elapsed", () => {
    const failedAt = new Date(NOW - FAILURE_BACKOFF_MS + 1000).toISOString();
    expect(inFailureBackoff({ version: 1, failedAt }, NOW)).toBe(true);
    const old = new Date(NOW - FAILURE_BACKOFF_MS - 1000).toISOString();
    expect(inFailureBackoff({ version: 1, failedAt: old }, NOW)).toBe(false);
  });

  test("is false when failedAt is in the future (clock went backwards)", () => {
    const failedAt = new Date(NOW + 2 * FAILURE_BACKOFF_MS).toISOString();
    expect(inFailureBackoff({ version: 1, failedAt }, NOW)).toBe(false);
  });
});
