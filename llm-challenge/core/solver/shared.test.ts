import { describe, expect, it } from "vitest";
import { detectInfraFailure } from "./shared";

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
