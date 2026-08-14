import { describe, expect, test } from "vitest";
import { defineAIGateway } from "./index";

describe("defineAIGateway", () => {
  test("returns the given name and config", () => {
    const aiGateway = defineAIGateway("my-aigateway", {
      authNamespace: "my-auth",
      cors: ["https://example.com"],
    });

    expect(aiGateway).toEqual({
      name: "my-aigateway",
      authNamespace: "my-auth",
      cors: ["https://example.com"],
    });
  });

  test("allows authNamespace to be omitted", () => {
    const aiGateway = defineAIGateway("my-aigateway", { cors: ["https://example.com"] });

    expect(aiGateway).toEqual({
      name: "my-aigateway",
      cors: ["https://example.com"],
    });
  });
});
