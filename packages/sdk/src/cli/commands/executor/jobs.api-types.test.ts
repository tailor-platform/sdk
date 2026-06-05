import { describe, test } from "vitest";
import { createExecutor } from "@/configure/services/executor";
import { scheduleTrigger } from "@/configure/services/executor/trigger/schedule";
import {
  type ListExecutorJobsOptions,
  type ListExecutorJobsTypedOptions,
  type GetExecutorJobOptions,
  type GetExecutorJobTypedOptions,
  type WatchExecutorJobOptions,
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

  test("keeps deprecated ListExecutorJobsOptions shape available", () => {
    const acceptsDeprecatedOptions = (_options: ListExecutorJobsOptions): void => {};

    acceptsDeprecatedOptions({
      executorName: "legacy-executor",
    });

    acceptsDeprecatedOptions({
      executorName: "legacy-executor",
      order: "desc",
      limit: 25,
    });

    acceptsDeprecatedOptions({
      // @ts-expect-error - deprecated options must keep legacy executorName shape
      executor: myExecutor,
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

  test("keeps deprecated GetExecutorJobOptions shape available", () => {
    const acceptsDeprecatedOptions = (_options: GetExecutorJobOptions): void => {};

    acceptsDeprecatedOptions({
      executorName: "legacy-executor",
      jobId: "job-1",
    });

    acceptsDeprecatedOptions({
      // @ts-expect-error - deprecated options must keep legacy executorName shape
      executor: myExecutor,
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

  test("keeps deprecated WatchExecutorJobOptions shape available", () => {
    const acceptsDeprecatedOptions = (_options: WatchExecutorJobOptions): void => {};

    acceptsDeprecatedOptions({
      executorName: "legacy-executor",
      jobId: "job-1",
    });

    acceptsDeprecatedOptions({
      // @ts-expect-error - deprecated options must keep legacy executorName shape
      executor: myExecutor,
      jobId: "job-1",
    });
  });
});
