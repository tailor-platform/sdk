import { describe, expectTypeOf, test } from "vitest";
import type { SeedPluginOptions } from "./index";

describe("SeedPluginOptions", () => {
  test("takes any machine user name, or the name with its Auth service", () => {
    const fromEnv: string = "seeder";
    expectTypeOf({ distPath: "./seed", machineUserName: fromEnv }).toExtend<SeedPluginOptions>();
    expectTypeOf({
      distPath: "./seed",
      machineUserName: { namespace: "corp-auth", machineUserName: fromEnv },
    }).toExtend<SeedPluginOptions>();
  });
});
