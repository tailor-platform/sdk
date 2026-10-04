import { describe, expect, test } from "vitest";
import { detectRepository } from "./git";

const origin = (url: string | null) => () => url;

describe("detectRepository", () => {
  test.each([
    ["git@github.com:tailor-platform/sdk.git"],
    ["https://github.com/tailor-platform/sdk.git"],
    ["https://github.com/tailor-platform/sdk"],
    ["ssh://git@github.com/tailor-platform/sdk.git"],
  ])("reads the owner and name from the origin URL %s", (url) => {
    expect(detectRepository("/repo", origin(url))).toEqual({
      owner: "tailor-platform",
      name: "sdk",
    });
  });

  test("returns null without an origin remote", () => {
    expect(detectRepository("/repo", origin(null))).toBeNull();
  });

  test("returns null for a host other than github.com", () => {
    expect(
      detectRepository("/repo", origin("git@github.example.com:tailor-platform/sdk.git")),
    ).toBeNull();
  });

  test("returns null when the name has characters unsafe to embed in commands", () => {
    expect(detectRepository("/repo", origin("https://github.com/acme/app;rm -rf"))).toBeNull();
  });
});
