import { describe, expect, test } from "vitest";
import { parseRepoView } from "./gh";

const view = (nameWithOwner: string, url: string) => JSON.stringify({ nameWithOwner, url });

describe("parseRepoView", () => {
  test.each([["https://github.com/acme/app"], ["https://GitHub.com/acme/app"]])(
    "leaves the host out for github.com (%s)",
    (url) => {
      expect(parseRepoView(view("acme/app", url))).toEqual({ owner: "acme", name: "app" });
    },
  );

  test("keeps the host of a GitHub Enterprise Server repository, without its port", () => {
    expect(parseRepoView(view("acme/app", "https://ghe.example.com:8443/acme/app"))).toEqual({
      host: "ghe.example.com",
      owner: "acme",
      name: "app",
    });
  });

  test.each([
    ["a host", view("acme/app", "https://ghe$(id).example.com/acme/app")],
    ["a name", view("acme/app;rm -rf", "https://ghe.example.com/acme/app")],
  ])("returns null when %s has characters unsafe to embed in commands", (_, stdout) => {
    expect(parseRepoView(stdout)).toBeNull();
  });

  test("returns null for output that is not the expected JSON", () => {
    expect(parseRepoView("not json")).toBeNull();
  });
});
