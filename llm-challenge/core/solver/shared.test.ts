import { describe, expect, it } from "vitest";
import { detectInfraFailure } from "./shared";

describe("detectInfraFailure", () => {
  it.each([
    // Codex / OpenAI API failures
    ["401 Unauthorized: invalid_api_key"],
    ["Authentication failed: please run codex login"],
    ["Please run `codex login` to refresh your session"],
    ["429 Too Many Requests"],
    ["rate limit exceeded for organization"],
    ["You've hit your usage limit. Upgrade to Pro or try again at 1:59 PM."],
    // Network transients between container and api.openai.com
    ["fetch failed: connect ECONNREFUSED api.openai.com:443"],
    ["ECONNRESET while reading response"],
    ["ETIMEDOUT contacting api.openai.com"],
    ["socket hang up"],
    ["network error: DNS resolution failed"],
    // Podman engine failures
    ["OCI runtime error: exec failed"],
    ["podman machine error: VM is not running"],
    ["image llm-challenge-runner not found"],
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
