import { beforeEach, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken } from "#/cli/shared/context";
import { createPatOperatorClient } from "./user";

vi.mock("#/cli/shared/client", () => ({
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

test("initializes the client with the platform config remembered for the token", async () => {
  vi.mocked(loadAccessToken).mockResolvedValue("scoped-token");

  await createPatOperatorClient("missing-profile");

  expect(loadAccessToken).toHaveBeenCalledWith({ profile: "missing-profile" });
  expect(initOperatorClient).toHaveBeenCalledWith("scoped-token");
});
