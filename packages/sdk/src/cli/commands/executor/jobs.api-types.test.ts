// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { describe, test } from "vitest";
import { createExecutor } from "#/configure/services/executor/index";
import { scheduleTrigger } from "#/configure/services/executor/trigger/schedule";
import {
  type ListExecutorJobsTypedOptions,
  type GetExecutorJobTypedOptions,
  type WatchExecutorJobTypedOptions,
} from "./jobs";

const myExecutor = createExecutor({
  name: "my-executor",
  trigger: scheduleTrigger({ cron: "0 12 * * *" }),
  operation: {
    kind: "function",
    body: () => {},
  },
});

describe("listExecutorJobs API types", () => {
  test("accepts typed options with executor definition", () => {
    const acceptsOptions = (_options: ListExecutorJobsTypedOptions<typeof myExecutor>): void => {};

    acceptsOptions({
      executor: myExecutor,
    });

    acceptsOptions({
      executor: myExecutor,
      status: "RUNNING",
      order: "asc",
      limit: 10,
      workspaceId: "ws-1",
      profile: "dev",
    });
  });

  test("rejects invalid order values", () => {
    const acceptsOptions = (_options: ListExecutorJobsTypedOptions): void => {};

    acceptsOptions({
      executor: { name: "any-executor" },
      // @ts-expect-error - only "asc" and "desc" are valid
      order: "oldest",
    });
  });

  test("works with default generic when ListExecutorJobsTypedOptions generic is omitted", () => {
    const acceptsDefaultOptions = (_options: ListExecutorJobsTypedOptions): void => {};

    acceptsDefaultOptions({
      executor: myExecutor,
    });

    acceptsDefaultOptions({
      executor: { name: "any-executor" },
    });
  });

  test("rejects legacy options shape in typed overload", () => {
    const acceptsTypedOptions = (_options: ListExecutorJobsTypedOptions): void => {};

    acceptsTypedOptions({
      // @ts-expect-error - typed overload requires executor, not executorName
      executorName: "legacy-executor",
    });
  });
});

describe("getExecutorJob API types", () => {
  test("accepts typed options with executor definition", () => {
    const acceptsOptions = (_options: GetExecutorJobTypedOptions<typeof myExecutor>): void => {};

    acceptsOptions({
      executor: myExecutor,
      jobId: "job-1",
    });

    acceptsOptions({
      executor: myExecutor,
      jobId: "job-1",
      attempts: true,
      workspaceId: "ws-1",
      profile: "dev",
    });
  });

  test("works with default generic when GetExecutorJobTypedOptions generic is omitted", () => {
    const acceptsDefaultOptions = (_options: GetExecutorJobTypedOptions): void => {};

    acceptsDefaultOptions({
      executor: myExecutor,
      jobId: "job-1",
    });

    acceptsDefaultOptions({
      executor: { name: "any-executor" },
      jobId: "job-1",
    });
  });

  test("rejects legacy options shape in typed overload", () => {
    const acceptsTypedOptions = (_options: GetExecutorJobTypedOptions): void => {};

    acceptsTypedOptions({
      // @ts-expect-error - typed overload requires executor, not executorName
      executorName: "legacy-executor",
      jobId: "job-1",
    });
  });
});

describe("watchExecutorJob API types", () => {
  test("accepts typed options with executor definition", () => {
    const acceptsOptions = (_options: WatchExecutorJobTypedOptions<typeof myExecutor>): void => {};

    acceptsOptions({
      executor: myExecutor,
      jobId: "job-1",
    });

    acceptsOptions({
      executor: myExecutor,
      jobId: "job-1",
      interval: 5000,
      logs: true,
      workspaceId: "ws-1",
      profile: "dev",
    });
  });

  test("works with default generic when WatchExecutorJobTypedOptions generic is omitted", () => {
    const acceptsDefaultOptions = (_options: WatchExecutorJobTypedOptions): void => {};

    acceptsDefaultOptions({
      executor: myExecutor,
      jobId: "job-1",
    });

    acceptsDefaultOptions({
      executor: { name: "any-executor" },
      jobId: "job-1",
    });
  });

  test("rejects legacy options shape in typed overload", () => {
    const acceptsTypedOptions = (_options: WatchExecutorJobTypedOptions): void => {};

    acceptsTypedOptions({
      // @ts-expect-error - typed overload requires executor, not executorName
      executorName: "legacy-executor",
      jobId: "job-1",
    });
  });
});
