import { runCommand } from "@politty/zod";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { updateCommand } from "./update";
import { createPatOperatorClient } from "./user";

vi.mock("#/cli/shared/readonly-guard", () => ({ assertWritable: vi.fn() }));
vi.mock("./user", () => ({ createPatOperatorClient: vi.fn() }));

describe("user pat update", () => {
  beforeEach(() => {
    vi.mocked(assertWritable).mockResolvedValue(undefined);
    vi.mocked(createPatOperatorClient).mockResolvedValue(
      mockOperatorClient({
        deletePersonalAccessToken: {},
        createPersonalAccessToken: { accessToken: "token" },
      }),
    );
  });

  test("applies an explicit profile to the readonly guard and operator client", async () => {
    const result = await runCommand(updateCommand, ["token-name", "--profile", "readonly"]);

    expect(result.success).toBe(true);
    expect(assertWritable).toHaveBeenCalledWith({ profile: "readonly" });
    expect(createPatOperatorClient).toHaveBeenCalledWith("readonly");
  });
});
