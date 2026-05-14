import { describe, expect, it } from "vitest";
import { detectInfraFailure } from "./shared";

describe("detectInfraFailure", () => {
  it.each([
    ["fetch failed: connect ECONNREFUSED 11434"],
    ["socket hang up while reading response"],
    ["ETIMEDOUT contacting ollama"],
    ["model gpt-oss:20b not found, try pulling it first"],
    ["Error: no such model 'qwen3-coder:30b'"],
    ["pull model manifest: not authorized"],
    ["failed to load model from disk"],
    ["llama runner process out of memory"],
    ["CUDA error: device-side assert triggered"],
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
