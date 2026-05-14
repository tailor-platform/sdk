import { describe, expect, it } from "vitest";
import { detectInfraFailure, extractRateLimitResetMs, isRateLimitError } from "./shared";

describe("detectInfraFailure", () => {
  it.each([
    ["You've hit your limit · resets 4:30am (UTC)"],
    ["You've hit your usage limit. Try again later."],
    ["rate limit reached for opus on this account"],
    ["Usage limit exceeded"],
    ["Quota exhausted, please retry tomorrow"],
    ["Not logged in. Please run claude setup-token."],
    ["403 Forbidden — token expired"],
    ["ETIMEDOUT while contacting api.anthropic.com"],
  ])("classifies %s as an infra failure", (output) => {
    expect(detectInfraFailure(output)).toBe(true);
  });

  it.each([
    ["TypeError: Cannot read property 'foo' of undefined"],
    ["SDK generate failed: missing tailor.config.ts"],
    ["Test suite failed: 3 of 14 tests failed"],
    [""],
  ])("does not classify %s as an infra failure", (output) => {
    expect(detectInfraFailure(output)).toBe(false);
  });
});

describe("isRateLimitError", () => {
  it.each([
    ["You've hit your limit · resets 4:30am (UTC)"],
    ["rate limit reached"],
    ["Usage limit exceeded"],
    ["Quota exhausted, please retry tomorrow"],
    ["HTTP 429 Too Many Requests"],
    ["error: rate_limit_exceeded"],
    ["TooManyRequests: please retry"],
  ])("classifies %s as a rate-limit error", (output) => {
    expect(isRateLimitError(output)).toBe(true);
  });

  it.each([
    ["Not logged in. Please run claude setup-token."],
    ["403 Forbidden — token expired"],
    ["ETIMEDOUT while contacting api.anthropic.com"],
    [""],
  ])("does NOT classify %s as a rate-limit (other infra failures)", (output) => {
    expect(isRateLimitError(output)).toBe(false);
  });
});

describe("extractRateLimitResetMs", () => {
  it("parses '3:10pm (UTC)' relative to a 'now' before that time today", () => {
    const now = new Date(Date.UTC(2026, 4, 14, 11, 0, 0)); // 2026-05-14 11:00 UTC
    const ms = extractRateLimitResetMs("You've hit your limit · resets 3:10pm (UTC)", now);
    expect(ms).not.toBeNull();
    const dt = new Date(ms!);
    expect(dt.getUTCHours()).toBe(15);
    expect(dt.getUTCMinutes()).toBe(10);
    expect(dt.getUTCDate()).toBe(14);
  });

  it("rolls to tomorrow when the reset time has already passed today", () => {
    const now = new Date(Date.UTC(2026, 4, 14, 16, 0, 0)); // 16:00 UTC
    const ms = extractRateLimitResetMs("resets 3:10pm (UTC)", now);
    expect(ms).not.toBeNull();
    expect(new Date(ms!).getUTCDate()).toBe(15); // next day
  });

  it("handles 24h format without am/pm", () => {
    const now = new Date(Date.UTC(2026, 4, 14, 10, 0, 0));
    const ms = extractRateLimitResetMs("resets at 15:10 UTC", now);
    expect(ms).not.toBeNull();
    const dt = new Date(ms!);
    expect(dt.getUTCHours()).toBe(15);
    expect(dt.getUTCMinutes()).toBe(10);
  });

  it("returns null when no 'resets <time>' hint is present", () => {
    expect(extractRateLimitResetMs("rate limit reached")).toBeNull();
    expect(extractRateLimitResetMs("")).toBeNull();
  });
});
