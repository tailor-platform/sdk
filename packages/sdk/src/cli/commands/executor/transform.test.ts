import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  ExecutorJobStatus,
  ExecutorTargetType,
  ExecutorTriggerType,
} from "@tailor-platform/tailor-proto/executor_resource_pb";
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
} from "@tailor-platform/tailor-proto/executor_resource_pb";

const TIMESTAMP = create(TimestampSchema, { seconds: BigInt(1700000000), nanos: 0 });
const TIMESTAMP_ISO = "2023-11-14T22:13:20.000Z";

function baseExecutor(overrides: Record<string, unknown>): ExecutorExecutor {
  return {
    name: "executor",
    description: "",
    targetType: ExecutorTargetType.FUNCTION,
    disabled: false,
    ...overrides,
  } as ExecutorExecutor;
}

describe("transform", () => {
  describe("toExecutorJobListInfo", () => {
    test("transforms ExecutorJob to list info", () => {
      const job = {
        id: "job-123",
        executorName: "test-executor",
        status: ExecutorJobStatus.RUNNING,
        createdAt: TIMESTAMP,
      } as ExecutorJob;

      const result = toExecutorJobListInfo(job);

      expect(result.id).toBe("job-123");
      expect(result.executorName).toBe("test-executor");
      expect(result.status).toBe("RUNNING");
      expect(result.createdAt).toBe(TIMESTAMP_ISO);
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
      const job = {
        id: "job-123",
        executorName: "test-executor",
        status: ExecutorJobStatus.SUCCESS,
        scheduledAt: TIMESTAMP,
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      } as ExecutorJob;

      const result = toExecutorJobInfo(job);

      expect(result.id).toBe("job-123");
      expect(result.executorName).toBe("test-executor");
      expect(result.status).toBe("SUCCESS");
      expect(result.scheduledAt).toBe(TIMESTAMP_ISO);
      expect(result.createdAt).toBe(TIMESTAMP_ISO);
      expect(result.updatedAt).toBe(TIMESTAMP_ISO);
    });

    test.each([
      [ExecutorJobStatus.PENDING, "PENDING"],
      [ExecutorJobStatus.RUNNING, "RUNNING"],
      [ExecutorJobStatus.SUCCESS, "SUCCESS"],
      [ExecutorJobStatus.FAILED, "FAILED"],
      [ExecutorJobStatus.CANCELED, "CANCELED"],
      [ExecutorJobStatus.UNSPECIFIED, "UNSPECIFIED"],
    ])("handles status value %s -> %s", (status, expected) => {
      const job = { id: "job-123", executorName: "test-executor", status } as ExecutorJob;

      const result = toExecutorJobInfo(job);

      expect(result.status).toBe(expected);
    });
  });

  describe("toExecutorJobAttemptInfo", () => {
    test("transforms ExecutorJobAttempt to info", () => {
      const attempt = {
        id: "attempt-123",
        jobId: "job-123",
        status: ExecutorJobStatus.SUCCESS,
        error: "",
        startedAt: TIMESTAMP,
        finishedAt: TIMESTAMP,
        operationReference: "op-ref-123",
      } as ExecutorJobAttempt;

      const result = toExecutorJobAttemptInfo(attempt);

      expect(result.id).toBe("attempt-123");
      expect(result.jobId).toBe("job-123");
      expect(result.status).toBe("SUCCESS");
      expect(result.error).toBe("");
      expect(result.startedAt).toBe(TIMESTAMP_ISO);
      expect(result.finishedAt).toBe(TIMESTAMP_ISO);
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
    test.each([
      [
        "extracts typeName from condition for tailordb event",
        {
          triggerType: ExecutorTriggerType.EVENT,
          triggerConfig: {
            config: {
              case: "event" as const,
              value: {
                eventType: "tailordb.type_record.created",
                typedConfig: { case: undefined },
                condition: { expr: 'args.typeName === "User" && someOtherCondition' },
              },
            },
          },
        },
        "event: User created",
      ],
      [
        "extracts resolverName from condition for pipeline event",
        {
          triggerType: ExecutorTriggerType.EVENT,
          triggerConfig: {
            config: {
              case: "event" as const,
              value: {
                eventType: "pipeline.resolver.executed",
                typedConfig: { case: undefined },
                condition: { expr: 'args.resolverName === "myResolver"' },
              },
            },
          },
        },
        "event: myResolver executed",
      ],
      [
        "falls back to service name when condition has no name",
        {
          triggerType: ExecutorTriggerType.EVENT,
          triggerConfig: {
            config: {
              case: "event" as const,
              value: {
                eventType: "tailordb.type_record.created",
                typedConfig: { case: undefined },
              },
            },
          },
        },
        "event: tailordb type_record created",
      ],
      [
        "falls back to basic trigger type when config is missing",
        { triggerType: ExecutorTriggerType.EVENT, triggerConfig: undefined },
        "EVENT",
      ],
      [
        "formats idp user event trigger",
        {
          triggerType: ExecutorTriggerType.EVENT,
          triggerConfig: {
            config: {
              case: "event" as const,
              value: { eventType: "idp.user.created", typedConfig: { case: undefined } },
            },
          },
        },
        "event: idp user created",
      ],
      [
        "formats auth access token event trigger",
        {
          triggerType: ExecutorTriggerType.EVENT,
          triggerConfig: {
            config: {
              case: "event" as const,
              value: {
                eventType: "auth.access_token.issued",
                typedConfig: { case: undefined },
              },
            },
          },
        },
        "event: auth access_token issued",
      ],
      [
        "formats typed event trigger when legacy eventType is empty",
        {
          triggerType: ExecutorTriggerType.EVENT,
          triggerConfig: {
            config: {
              case: "event" as const,
              value: {
                eventType: "",
                typedConfig: {
                  case: "tailordb" as const,
                  value: {
                    eventTypes: ["tailordb.type_record.created"],
                    namespaceName: "sales",
                    typeName: "SalesOrder",
                  },
                },
              },
            },
          },
        },
        "event: SalesOrder created",
      ],
      [
        "formats multi-event typed auth trigger",
        {
          triggerType: ExecutorTriggerType.EVENT,
          triggerConfig: {
            config: {
              case: "event" as const,
              value: {
                eventType: "",
                typedConfig: {
                  case: "auth" as const,
                  value: {
                    eventTypes: [
                      "auth.access_token.issued",
                      "auth.access_token.refreshed",
                      "auth.access_token.revoked",
                    ],
                    namespaceName: "erp-auth",
                  },
                },
              },
            },
          },
        },
        "event: auth access_token issued, refreshed, revoked",
      ],
    ])("%s", (_name, overrides, expectedTriggerType) => {
      const executor = baseExecutor(overrides);

      const result = toExecutorListInfo(executor);

      expect(result.triggerType).toBe(expectedTriggerType);
    });

    test("formats schedule trigger with frequency and timezone", () => {
      const executor = baseExecutor({
        name: "scheduled-executor",
        triggerType: ExecutorTriggerType.SCHEDULE,
        triggerConfig: {
          config: {
            case: "schedule" as const,
            value: { timezone: "UTC", frequency: "0 12 * * *" },
          },
        },
        targetType: ExecutorTargetType.WEBHOOK,
        disabled: true,
      });

      const result = toExecutorListInfo(executor);

      expect(result.triggerType).toBe("schedule: 0 12 * * * (UTC)");
      expect(result.targetType).toBe("WEBHOOK");
      expect(result.disabled).toBe(true);
    });

    test("formats incomingWebhook as 'webhook'", () => {
      const executor = baseExecutor({
        name: "webhook-executor",
        triggerType: ExecutorTriggerType.INCOMING_WEBHOOK,
        triggerConfig: {
          config: { case: "incomingWebhook" as const, value: { secret: "my-secret" } },
        },
        targetType: ExecutorTargetType.TAILOR_GRAPHQL,
      });

      const result = toExecutorListInfo(executor);

      expect(result.triggerType).toBe("webhook");
      expect(result.targetType).toBe("GRAPHQL");
    });

    test("extracts name from condition and reports name/targetType/disabled", () => {
      const executor = baseExecutor({
        name: "test-executor",
        description: "Test executor",
        triggerType: ExecutorTriggerType.EVENT,
        triggerConfig: {
          config: {
            case: "event" as const,
            value: {
              eventType: "tailordb.type_record.created",
              typedConfig: { case: undefined },
              condition: { expr: 'args.typeName === "User" && someOtherCondition' },
            },
          },
        },
      });

      const result = toExecutorListInfo(executor);

      expect(result.name).toBe("test-executor");
      expect(result.triggerType).toBe("event: User created");
      expect(result.targetType).toBe("FUNCTION");
      expect(result.disabled).toBe(false);
    });
  });

  describe("toExecutorInfo", () => {
    test("transforms ExecutorExecutor with schedule trigger to detailed info", () => {
      const executor = baseExecutor({
        name: "scheduled-executor",
        description: "A scheduled executor",
        triggerType: ExecutorTriggerType.SCHEDULE,
        triggerConfig: {
          config: {
            case: "schedule" as const,
            value: { timezone: "UTC", frequency: "0 * * * *" },
          },
        },
        targetConfig: {
          config: { case: "function" as const, value: { name: "my-function" } },
        },
      });

      const result = toExecutorInfo(executor);

      expect(result.name).toBe("scheduled-executor");
      expect(result.description).toBe("A scheduled executor");
      expect(result.triggerType).toBe("schedule: 0 * * * * (UTC)");
      expect(result.targetType).toBe("FUNCTION");
      expect(result.disabled).toBe(false);
      expect(result.triggerConfig).toEqual({ timezone: "UTC", frequency: "0 * * * *" });
      expect(result.targetConfig).toEqual({ name: "my-function" });
    });

    test("transforms ExecutorExecutor with event trigger", () => {
      const executor = baseExecutor({
        name: "event-executor",
        description: "An event executor",
        triggerType: ExecutorTriggerType.EVENT,
        triggerConfig: {
          config: {
            case: "event" as const,
            value: {
              eventType: "user.created",
              typedConfig: { case: undefined },
              condition: { expr: "true" },
            },
          },
        },
        targetType: ExecutorTargetType.TAILOR_GRAPHQL,
        targetConfig: {
          config: {
            case: "tailorGraphql" as const,
            value: { appName: "my-app", query: "mutation { doSomething }" },
          },
        },
      });

      const result = toExecutorInfo(executor);

      expect(result.triggerConfig).toEqual({ eventType: "user.created", condition: "true" });
      expect(result.targetConfig).toEqual({
        appName: "my-app",
        query: "mutation { doSomething }",
      });
    });

    test("transforms typed TailorDB event trigger details when legacy eventType is empty", () => {
      const executor = baseExecutor({
        name: "order-created-audit",
        description: "Audit order creation",
        triggerType: ExecutorTriggerType.EVENT,
        triggerConfig: {
          config: {
            case: "event" as const,
            value: {
              eventType: "",
              typedConfig: {
                case: "tailordb" as const,
                value: {
                  eventTypes: ["tailordb.type_record.created"],
                  namespaceName: "sales",
                  typeName: "SalesOrder",
                  condition: { expr: "args.newRecord.total > 0" },
                },
              },
            },
          },
        },
      });

      const result = toExecutorInfo(executor);

      expect(result.triggerType).toBe("event: SalesOrder created");
      expect(result.triggerConfig).toEqual({
        kind: "tailordb",
        eventTypes: ["tailordb.type_record.created"],
        namespaceName: "sales",
        typeName: "SalesOrder",
        condition: "args.newRecord.total > 0",
      });
    });

    test("transforms typed IdP event trigger details", () => {
      const executor = baseExecutor({
        name: "idp-user-lifecycle",
        description: "Audit IdP user lifecycle",
        triggerType: ExecutorTriggerType.EVENT,
        triggerConfig: {
          config: {
            case: "event" as const,
            value: {
              eventType: "",
              typedConfig: {
                case: "idp" as const,
                value: {
                  eventTypes: ["idp.user.created", "idp.user.updated", "idp.user.deleted"],
                  namespaceName: "erp-idp",
                },
              },
            },
          },
        },
      });

      const result = toExecutorInfo(executor);

      expect(result.triggerType).toBe("event: idp user created, updated, deleted");
      expect(result.triggerConfig).toEqual({
        kind: "idp",
        eventTypes: ["idp.user.created", "idp.user.updated", "idp.user.deleted"],
        namespaceName: "erp-idp",
        condition: "",
      });
    });

    test("transforms typed auth access token event trigger details", () => {
      const executor = baseExecutor({
        name: "auth-token-lifecycle",
        description: "Audit auth token lifecycle",
        triggerType: ExecutorTriggerType.EVENT,
        triggerConfig: {
          config: {
            case: "event" as const,
            value: {
              eventType: "",
              typedConfig: {
                case: "auth" as const,
                value: {
                  eventTypes: [
                    "auth.access_token.issued",
                    "auth.access_token.refreshed",
                    "auth.access_token.revoked",
                  ],
                  namespaceName: "auth",
                },
              },
            },
          },
        },
      });

      const result = toExecutorInfo(executor);

      expect(result.triggerType).toBe("event: auth access_token issued, refreshed, revoked");
      expect(result.triggerConfig).toEqual({
        kind: "auth",
        eventTypes: [
          "auth.access_token.issued",
          "auth.access_token.refreshed",
          "auth.access_token.revoked",
        ],
        namespaceName: "auth",
        condition: "",
      });
    });

    test("transforms ExecutorExecutor with incoming webhook trigger", () => {
      const executor = baseExecutor({
        name: "webhook-executor",
        description: "A webhook executor",
        triggerType: ExecutorTriggerType.INCOMING_WEBHOOK,
        triggerConfig: {
          config: { case: "incomingWebhook" as const, value: { secret: "my-secret" } },
        },
        targetType: ExecutorTargetType.WEBHOOK,
        targetConfig: {
          config: {
            case: "webhook" as const,
            value: {
              url: { expr: '"https://example.com/webhook"' },
              headers: [{ key: "X-Custom", value: { case: "rawValue", value: "test" } }],
            },
          },
        },
      });

      const result = toExecutorInfo(executor);

      expect(result.triggerConfig).toEqual({ secret: "***" });
      expect(result.targetConfig).toEqual({ url: '"https://example.com/webhook"', headers: 1 });
    });

    test("transforms ExecutorExecutor with workflow target", () => {
      const executor = baseExecutor({
        name: "workflow-executor",
        description: "A workflow executor",
        triggerType: ExecutorTriggerType.EVENT,
        triggerConfig: {
          config: {
            case: "event" as const,
            value: { eventType: "order.created", typedConfig: { case: undefined } },
          },
        },
        targetType: ExecutorTargetType.WORKFLOW,
        targetConfig: {
          config: { case: "workflow" as const, value: { workflowName: "order-processing" } },
        },
      });

      const result = toExecutorInfo(executor);

      expect(result.targetConfig).toEqual({ workflowName: "order-processing" });
    });

    test("handles missing trigger config", () => {
      const executor = baseExecutor({
        name: "minimal-executor",
        triggerType: ExecutorTriggerType.UNSPECIFIED,
        triggerConfig: undefined,
        targetType: ExecutorTargetType.UNSPECIFIED,
        targetConfig: undefined,
      });

      const result = toExecutorInfo(executor);

      expect(result.triggerConfig).toEqual({});
      expect(result.targetConfig).toEqual({});
    });

    test("handles undefined config case", () => {
      const executor = baseExecutor({
        name: "edge-case-executor",
        triggerType: ExecutorTriggerType.SCHEDULE,
        triggerConfig: { config: { case: undefined, value: undefined } },
        targetConfig: { config: { case: undefined, value: undefined } },
      });

      const result = toExecutorInfo(executor);

      expect(result.triggerConfig).toEqual({});
      expect(result.targetConfig).toEqual({});
    });
  });
});
