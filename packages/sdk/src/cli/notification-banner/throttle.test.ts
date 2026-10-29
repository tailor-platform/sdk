import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { tempDir } from "#/cli/shared/test-helpers/temp-dir";
import {
  BANNER_INTERVAL_MS,
  getBannerStatePath,
  isThrottled,
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
    fs.writeFileSync(file, JSON.stringify({ version: 1, shownAt: 42 }));
    expect(readBannerState(file)).toBeUndefined();
  });

  test("round-trips what writeBannerState wrote, creating the directory", () => {
    using tmp = tempDir("banner-");
    const file = path.join(tmp.dir, "nested", "state.json");
    const state = { version: 1 as const, shownAt: new Date(NOW).toISOString(), lastSeenIds: ["a"] };
    writeBannerState(file, state);
    expect(readBannerState(file)).toEqual(state);
    expect(fs.readdirSync(path.dirname(file))).toEqual(["state.json"]);
  });

  test("tolerates extra keys written by a newer SDK", () => {
    using tmp = tempDir("banner-");
    const file = path.join(tmp.dir, "state.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        shownAt: new Date(NOW).toISOString(),
        lastSeenIds: [],
        extra: 1,
      }),
    );
    expect(readBannerState(file)?.shownAt).toBe(new Date(NOW).toISOString());
  });
});

describe("isThrottled", () => {
  test("is false with no state", () => {
    expect(isThrottled(undefined, NOW)).toBe(false);
  });

  test("is true within the interval and false once it has elapsed", () => {
    const shownAt = new Date(NOW - BANNER_INTERVAL_MS + 1000).toISOString();
    expect(isThrottled({ version: 1, shownAt, lastSeenIds: [] }, NOW)).toBe(true);
    const old = new Date(NOW - BANNER_INTERVAL_MS - 1000).toISOString();
    expect(isThrottled({ version: 1, shownAt: old, lastSeenIds: [] }, NOW)).toBe(false);
  });

  test("is false when shownAt is in the future (clock went backwards)", () => {
    const shownAt = new Date(NOW + 2 * BANNER_INTERVAL_MS).toISOString();
    expect(isThrottled({ version: 1, shownAt, lastSeenIds: [] }, NOW)).toBe(false);
  });
});
