// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { describe, test } from "vitest";
import { type GetMachineUserTokenOptions } from "./token";

const acceptsTokenOptions = (_options: GetMachineUserTokenOptions): void => {};

describe("getMachineUserToken API types", () => {
  test("does not expose machine user source tracking", () => {
    acceptsTokenOptions({
      name: "manager-bot",
    });

    acceptsTokenOptions({
      name: "manager-bot",
      // @ts-expect-error - source tracking is internal to CLI commands
      nameSource: "option",
    });
  });
});
