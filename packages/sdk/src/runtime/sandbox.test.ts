/**
 * Tests for `@tailor-platform/sdk/runtime/sandbox` typed wrappers.
 */
import { aroundEach, describe, expect, expectTypeOf, test } from "vitest";
import { sandbox, type PlatformSandboxAPI, type Sandbox } from "#/runtime/sandbox";
import { injectMocks, mockSandbox } from "#/vitest/mock";

describe("@tailor-platform/sdk/runtime/sandbox", () => {
  aroundEach(async (runTest) => {
    using _mocks = injectMocks(globalThis);
    await runTest();
  });

  test("exposes the platform sandbox API", () => {
    expectTypeOf(sandbox).toExtend<PlatformSandboxAPI>();
  });

  test("create delegates to tailor.sandbox.create and returns Promise<Sandbox>", async () => {
    using sb = mockSandbox();

    const promise = sandbox.create({ template: "guest", name: "dev" });

    expectTypeOf(promise).toEqualTypeOf<Promise<Sandbox>>();
    const created = await promise;
    expect(created.name).toBe("dev");
    expect(sb.create.mock.calls).toEqual([[{ template: "guest", name: "dev" }]]);
  });

  test("getOrCreate delegates and returns the existing sandbox on the second call", async () => {
    using sb = mockSandbox();

    const first = await sandbox.getOrCreate({ name: "dev", template: "guest" });
    const second = await sandbox.getOrCreate({ name: "dev", template: "guest" });

    expect(second.id).toBe(first.id);
    expect(sb.getOrCreate).toHaveBeenCalledTimes(2);
  });

  test("get delegates with the sandbox id", async () => {
    using sb = mockSandbox();
    const created = await sandbox.create({ template: "guest" });

    await expect(sandbox.get(created.id)).resolves.toBe(created);
    expect(sb.get.mock.calls).toEqual([[created.id]]);
  });

  test("getByName delegates with the sandbox name", async () => {
    using sb = mockSandbox();
    const created = await sandbox.create({ template: "guest", name: "dev" });

    await expect(sandbox.getByName("dev")).resolves.toBe(created);
    expect(sb.getByName.mock.calls).toEqual([["dev"]]);
  });

  test("SandboxError is the class the runtime exposes", async () => {
    using _sb = mockSandbox();

    const error = await sandbox.get("missing").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(sandbox.SandboxError);
    expect(error).toMatchObject({ name: "SandboxError", code: "NOT_FOUND" });
  });
});
