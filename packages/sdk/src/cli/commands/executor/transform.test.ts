import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  ExecutorJobStatus,
  ExecutorTargetType,
  ExecutorTriggerType,
} from "@tailor-proto/tailor/v1/executor_resource_pb";
import { describe, expect, test } from "vitest";
import {
  toExecutorInfo,
  toExecutorJobAttemptInfo,
  toExecutorJobInfo,
  toExecutorJobListInfo,
  toExecutorListInfo,
} from "./transform";
import type {
  ExecutorExecutor,
  ExecutorJob,
  ExecutorJobAttempt,
} from "@tailor-proto/tailor/v1/executor_resource_pb";

describe("transform", () => {
  describe("toExecutorJobListInfo", () => {
    test("transforms ExecutorJob to list info", () => {
      const timestamp = create(TimestampSchema, {
        seconds: BigInt(1700000000),
        nanos: 0,
      });
      const job = {
        id: "job-123",
        executorName: "test-executor",
        status: ExecutorJobStatus.RUNNING,
        createdAt: timestamp,
      } as ExecutorJob;

      const result = toExecutorJobListInfo(job);

      expect(result.id).toBe("job-123");
      expect(result.executorName).toBe("test-executor");
      expect(result.status).toBe("RUNNING");
      expect(result.createdAt).toBe("2023-11-14T22:13:20.000Z");
    });

    test("handles missing createdAt", () => {
      const job = {
        id: "job-123",
        executorName: "test-executor",
        status: ExecutorJobStatus.PENDING,
        createdAt: undefined,
      } as ExecutorJob;

      const result = toExecutorJobListInfo(job);

      expect(result.createdAt).toBe("N/A");
    });
  });

  describe("toExecutorJobInfo", () => {
    test("transforms ExecutorJob to detailed info", () => {
      const timestamp = create(TimestampSchema, {
        seconds: BigInt(1700000000),
        nanos: 0,
      });
      const job = {
        id: "job-123",
        executorName: "test-executor",
        status: ExecutorJobStatus.SUCCESS,
        scheduledAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      } as ExecutorJob;

      const result = toExecutorJobInfo(job);

      expect(result.id).toBe("job-123");
      expect(result.executorName).toBe("test-executor");
      expect(result.status).toBe("SUCCESS");
      expect(result.scheduledAt).toBe("2023-11-14T22:13:20.000Z");
      expect(result.createdAt).toBe("2023-11-14T22:13:20.000Z");
      expect(result.updatedAt).toBe("2023-11-14T22:13:20.000Z");
    });

    test("handles all status values", () => {
      const statusCases = [
        { status: ExecutorJobStatus.PENDING, expected: "PENDING" },
        { status: ExecutorJobStatus.RUNNING, expected: "RUNNING" },
        { status: ExecutorJobStatus.SUCCESS, expected: "SUCCESS" },
        { status: ExecutorJobStatus.FAILED, expected: "FAILED" },
        { status: ExecutorJobStatus.CANCELED, expected: "CANCELED" },
        { status: ExecutorJobStatus.UNSPECIFIED, expected: "UNSPECIFIED" },
      ];

      for (const { status, expected } of statusCases) {
        const job = {
          id: "job-123",
          executorName: "test-executor",
          status,
        } as ExecutorJob;

        const result = toExecutorJobInfo(job);
        expect(result.status).toBe(expected);
      }
    });
  });

  describe("toExecutorJobAttemptInfo", () => {
    test("transforms ExecutorJobAttempt to info", () => {
      const timestamp = create(TimestampSchema, {
        seconds: BigInt(1700000000),
        nanos: 0,
      });
      const attempt = {
        id: "attempt-123",
        jobId: "job-123",
        status: ExecutorJobStatus.SUCCESS,
        error: "",
        startedAt: timestamp,
        finishedAt: timestamp,
        operationReference: "op-ref-123",
      } as ExecutorJobAttempt;

      const result = toExecutorJobAttemptInfo(attempt);

      expect(result.id).toBe("attempt-123");
      expect(result.jobId).toBe("job-123");
      expect(result.status).toBe("SUCCESS");
      expect(result.error).toBe("");
      expect(result.startedAt).toBe("2023-11-14T22:13:20.000Z");
      expect(result.finishedAt).toBe("2023-11-14T22:13:20.000Z");
      expect(result.operationReference).toBe("op-ref-123");
    });

    test("handles failed attempt with error", () => {
      const attempt = {
        id: "attempt-123",
        jobId: "job-123",
        status: ExecutorJobStatus.FAILED,
        error: "Something went wrong",
        operationReference: "",
      } as ExecutorJobAttempt;

      const result = toExecutorJobAttemptInfo(attempt);

      expect(result.status).toBe("FAILED");
      expect(result.error).toBe("Something went wrong");
      expect(result.startedAt).toBe("N/A");
      expect(result.finishedAt).toBe("N/A");
    });
  });

  describe("toExecutorListInfo", () => {
    test("extracts typeName from condition for tailordb event", () => {
      const executor = {
        name: "test-executor",
        description: "Test executor",
        triggerType: ExecutorTriggerType.EVENT,
        triggerConfig: {
          config: {
            case: "event" as const,
            value: {
              eventType: "tailordb.type_record.created",
              condition: {
                expr: 'args.typeName === "User" && someOtherCondition',
              },
            },
          },
        },
        targetType: ExecutorTargetType.FUNCTION,
        disabled: false,
      } as ExecutorExecutor;

      const result = toExecutorListInfo(executor);

      expect(result.name).toBe("test-executor");
      expect(result.triggerType).toBe("event: User created");
      expect(result.targetType).toBe("FUNCTION");
      expect(result.disabled).toBe(false);
    });

    test("extracts resolverName from condition for pipeline event", () => {
      const executor = {
        name: "resolver-executor",
        triggerType: ExecutorTriggerType.EVENT,
        triggerConfig: {
          config: {
            case: "event" as const,
            value: {
              eventType: "pipeline.resolver.executed",
              condition: {
                expr: 'args.resolverName === "myResolver"',
              },
            },
          },
        },
        targetType: ExecutorTargetType.FUNCTION,
        disabled: false,
      } as ExecutorExecutor;

      const result = toExecutorListInfo(executor);

      expect(result.triggerType).toBe("event: myResolver executed");
    });

    test("falls back to service name when condition has no name", () => {
      const executor = {
        name: "fallback-executor",
        triggerType: ExecutorTriggerType.EVENT,
        triggerConfig: {
          config: {
            case: "event" as const,
            value: {
              eventType: "tailordb.type_record.created",
            },
          },
        },
        targetType: ExecutorTargetType.FUNCTION,
        disabled: false,
      } as ExecutorExecutor;

      const result = toExecutorListInfo(executor);

      expect(result.triggerType).toBe("event: tailordb type_record created");
    });

    test("formats schedule trigger with frequency and timezone", () => {
      const executor = {
        name: "scheduled-executor",
        triggerType: ExecutorTriggerType.SCHEDULE,
        triggerConfig: {
          config: {
            case: "schedule" as const,
            value: {
              timezone: "UTC",
              frequency: "0 12 * * *",
            },
          },
        },
        targetType: ExecutorTargetType.WEBHOOK,
        disabled: true,
      } as ExecutorExecutor;

      const result = toExecutorListInfo(executor);

      expect(result.triggerType).toBe("schedule: 0 12 * * * (UTC)");
      expect(result.targetType).toBe("WEBHOOK");
      expect(result.disabled).toBe(true);
    });

    test("formats incomingWebhook as 'webhook'", () => {
      const executor = {
        name: "webhook-executor",
        triggerType: ExecutorTriggerType.INCOMING_WEBHOOK,
        triggerConfig: {
          config: {
            case: "incomingWebhook" as const,
            value: {
              secret: "my-secret",
            },
          },
        },
        targetType: ExecutorTargetType.TAILOR_GRAPHQL,
        disabled: false,
      } as ExecutorExecutor;

      const result = toExecutorListInfo(executor);

      expect(result.triggerType).toBe("webhook");
      expect(result.targetType).toBe("GRAPHQL");
    });

    test("falls back to basic trigger type when config is missing", () => {
      const executor = {
        name: "no-config-executor",
        triggerType: ExecutorTriggerType.EVENT,
        triggerConfig: undefined,
        targetType: ExecutorTargetType.FUNCTION,
        disabled: false,
      } as ExecutorExecutor;

      const result = toExecutorListInfo(executor);

      expect(result.triggerType).toBe("EVENT");
    });

    test("formats idp user event trigger", () => {
      const executor = {
        name: "idp-executor",
        triggerType: ExecutorTriggerType.EVENT,
        triggerConfig: {
          config: {
            case: "event" as const,
            value: {
              eventType: "idp.user.created",
            },
          },
        },
        targetType: ExecutorTargetType.FUNCTION,
        disabled: false,
      } as ExecutorExecutor;

      const result = toExecutorListInfo(executor);

      expect(result.triggerType).toBe("event: idp user created");
    });

    test("formats auth access token event trigger", () => {
      const executor = {
        name: "auth-executor",
        triggerType: ExecutorTriggerType.EVENT,
        triggerConfig: {
          config: {
            case: "event" as const,
            value: {
              eventType: "auth.access_token.issued",
            },
          },
        },
        targetType: ExecutorTargetType.FUNCTION,
        disabled: false,
      } as ExecutorExecutor;

      const result = toExecutorListInfo(executor);

      expect(result.triggerType).toBe("event: auth access_token issued");
    });
  });

  describe("toExecutorInfo", () => {
    test("transforms ExecutorExecutor with schedule trigger to detailed info", () => {
      const executor = {
        name: "scheduled-executor",
        description: "A scheduled executor",
        triggerType: ExecutorTriggerType.SCHEDULE,
        triggerConfig: {
          config: {
            case: "schedule" as const,
            value: {
              timezone: "UTC",
              frequency: "0 * * * *",
            },
          },
        },
        targetType: ExecutorTargetType.FUNCTION,
        targetConfig: {
          config: {
            case: "function" as const,
            value: {
              name: "my-function",
            },
          },
        },
        disabled: false,
      } as ExecutorExecutor;

      const result = toExecutorInfo(executor);

      expect(result.name).toBe("scheduled-executor");
      expect(result.description).toBe("A scheduled executor");
      expect(result.triggerType).toBe("schedule: 0 * * * * (UTC)");
      expect(result.targetType).toBe("FUNCTION");
      expect(result.disabled).toBe(false);
      expect(result.triggerConfig).toBe(
        JSON.stringify({ timezone: "UTC", frequency: "0 * * * *" }, null, 2),
      );
      expect(result.targetConfig).toBe(JSON.stringify({ name: "my-function" }, null, 2));
    });

    test("transforms ExecutorExecutor with event trigger", () => {
      const executor = {
        name: "event-executor",
        description: "An event executor",
        triggerType: ExecutorTriggerType.EVENT,
        triggerConfig: {
          config: {
            case: "event" as const,
            value: {
              eventType: "user.created",
              condition: {
                expr: "true",
              },
            },
          },
        },
        targetType: ExecutorTargetType.TAILOR_GRAPHQL,
        targetConfig: {
          config: {
            case: "tailorGraphql" as const,
            value: {
              appName: "my-app",
              query: "mutation { doSomething }",
            },
          },
        },
        disabled: false,
      } as ExecutorExecutor;

      const result = toExecutorInfo(executor);

      expect(result.triggerConfig).toBe(
        JSON.stringify({ eventType: "user.created", condition: "true" }, null, 2),
      );
      expect(result.targetConfig).toBe(
        JSON.stringify({ appName: "my-app", query: "mutation { doSomething }" }, null, 2),
      );
    });

    test("transforms ExecutorExecutor with incoming webhook trigger", () => {
      const executor = {
        name: "webhook-executor",
        description: "A webhook executor",
        triggerType: ExecutorTriggerType.INCOMING_WEBHOOK,
        triggerConfig: {
          config: {
            case: "incomingWebhook" as const,
            value: {
              secret: "my-secret",
            },
          },
        },
        targetType: ExecutorTargetType.WEBHOOK,
        targetConfig: {
          config: {
            case: "webhook" as const,
            value: {
              url: {
                expr: '"https://example.com/webhook"',
              },
              headers: [{ key: "X-Custom", value: { case: "rawValue", value: "test" } }],
            },
          },
        },
        disabled: false,
      } as ExecutorExecutor;

      const result = toExecutorInfo(executor);

      expect(result.triggerConfig).toBe(JSON.stringify({ secret: "***" }, null, 2));
      expect(result.targetConfig).toBe(
        JSON.stringify({ url: '"https://example.com/webhook"', headers: 1 }, null, 2),
      );
    });

    test("transforms ExecutorExecutor with workflow target", () => {
      const executor = {
        name: "workflow-executor",
        description: "A workflow executor",
        triggerType: ExecutorTriggerType.EVENT,
        triggerConfig: {
          config: {
            case: "event" as const,
            value: {
              eventType: "order.created",
            },
          },
        },
        targetType: ExecutorTargetType.WORKFLOW,
        targetConfig: {
          config: {
            case: "workflow" as const,
            value: {
              workflowName: "order-processing",
            },
          },
        },
        disabled: false,
      } as ExecutorExecutor;

      const result = toExecutorInfo(executor);

      expect(result.targetConfig).toBe(
        JSON.stringify({ workflowName: "order-processing" }, null, 2),
      );
    });

    test("handles missing trigger config", () => {
      const executor = {
        name: "minimal-executor",
        description: "",
        triggerType: ExecutorTriggerType.UNSPECIFIED,
        triggerConfig: undefined,
        targetType: ExecutorTargetType.UNSPECIFIED,
        targetConfig: undefined,
        disabled: false,
      } as ExecutorExecutor;

      const result = toExecutorInfo(executor);

      expect(result.triggerConfig).toBe("{}");
      expect(result.targetConfig).toBe("{}");
    });

    test("handles undefined config case", () => {
      const executor = {
        name: "edge-case-executor",
        description: "",
        triggerType: ExecutorTriggerType.SCHEDULE,
        triggerConfig: {
          config: {
            case: undefined,
            value: undefined,
          },
        },
        targetType: ExecutorTargetType.FUNCTION,
        targetConfig: {
          config: {
            case: undefined,
            value: undefined,
          },
        },
        disabled: false,
      } as ExecutorExecutor;

      const result = toExecutorInfo(executor);

      expect(result.triggerConfig).toBe("{}");
      expect(result.targetConfig).toBe("{}");
    });
  });
});
