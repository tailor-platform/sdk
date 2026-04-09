import { describe, it } from "vitest";
import { createExecutor } from "@/configure/services/executor";
import { scheduleTrigger } from "@/configure/services/executor/trigger/schedule";
import { type GetExecutorOptions, type GetExecutorTypedOptions } from "./get";

const myExecutor = createExecutor({
  name: "my-executor",
  trigger: scheduleTrigger({ cron: "0 12 * * *" }),
  operation: {
    kind: "function",
    body: () => {},
  },
});

describe("getExecutor API types", () => {
  it("accepts typed options with executor definition", () => {
    const acceptsOptions = (_options: GetExecutorTypedOptions<typeof myExecutor>): void => {};

    acceptsOptions({
      executor: myExecutor,
    });

    acceptsOptions({
      executor: myExecutor,
      workspaceId: "ws-1",
      profile: "dev",
    });
  });

  it("works with default generic when GetExecutorTypedOptions generic is omitted", () => {
    const acceptsDefaultOptions = (_options: GetExecutorTypedOptions): void => {};

    acceptsDefaultOptions({
      executor: myExecutor,
    });

    acceptsDefaultOptions({
      executor: { name: "any-executor" },
    });
  });

  it("rejects legacy options shape in typed overload", () => {
    const acceptsTypedOptions = (_options: GetExecutorTypedOptions): void => {};

    acceptsTypedOptions({
      // @ts-expect-error - typed overload requires executor, not name
      name: "legacy-executor",
    });
  });

  it("keeps deprecated GetExecutorOptions shape available", () => {
    const acceptsDeprecatedOptions = (_options: GetExecutorOptions): void => {};

    acceptsDeprecatedOptions({
      name: "legacy-executor",
    });

    acceptsDeprecatedOptions({
      name: "legacy-executor",
      workspaceId: "ws-1",
      profile: "dev",
    });

    acceptsDeprecatedOptions({
      // @ts-expect-error - deprecated options must keep legacy name shape
      executor: myExecutor,
    });
  });
});
