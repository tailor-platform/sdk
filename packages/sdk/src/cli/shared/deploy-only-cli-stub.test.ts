import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { createHookFailures } from "#/cli/services/hook-failures";
import { createDeployOnlyCliStubPlugin } from "./deploy-only-cli-stub";

const builtCliEntry = fileURLToPath(new URL("../../../dist/cli/lib.mjs", import.meta.url));

test("declares every export of the built CLI entry point", async () => {
  const plugin = createDeployOnlyCliStubPlugin(createHookFailures());
  const load = plugin.load as (id: string) => Promise<string>;
  const stub = await load.call({}, `\0tailor-platform-sdk-cli-stub:${builtCliEntry}`);
  const stubbed = [...stub.matchAll(/^export const (\S+) =/gm)].map((match) => match[1]);

  const real = Object.keys(await import(builtCliEntry)).filter((name) => name !== "default");

  expect(stubbed.toSorted()).toEqual(real.toSorted());
});
