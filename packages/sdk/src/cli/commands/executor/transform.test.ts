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
              typedConfig: { case: undefined },
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
              typedConfig: { case: undefined },
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
              typedConfig: { case: undefined },
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
              typedConfig: { case: undefined },
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
              typedConfig: { case: undefined },
            },
          },
        },
        targetType: ExecutorTargetType.FUNCTION,
        disabled: false,
      } as ExecutorExecutor;

      const result = toExecutorListInfo(executor);

      expect(result.triggerType).toBe("event: auth access_token issued");
    });

    test("formats typed event trigger when legacy eventType is empty", () => {
      const executor = {
        name: "typed-tailordb-executor",
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
        targetType: ExecutorTargetType.FUNCTION,
        disabled: false,
      } as ExecutorExecutor;

      const result = toExecutorListInfo(executor);

      expect(result.triggerType).toBe("event: SalesOrder created");
    });

    test("formats multi-event typed auth trigger", () => {
      const executor = {
        name: "typed-auth-executor",
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
        targetType: ExecutorTargetType.FUNCTION,
        disabled: false,
      } as ExecutorExecutor;

      const result = toExecutorListInfo(executor);

      expect(result.triggerType).toBe("event: auth access_token issued, refreshed, revoked");
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
      expect(result.triggerConfig).toEqual({ timezone: "UTC", frequency: "0 * * * *" });
      expect(result.targetConfig).toEqual({ name: "my-function" });
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
              typedConfig: { case: undefined },
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

      expect(result.triggerConfig).toEqual({ eventType: "user.created", condition: "true" });
      expect(result.targetConfig).toEqual({
        appName: "my-app",
        query: "mutation { doSomething }",
      });
    });

    test("transforms typed TailorDB event trigger details when legacy eventType is empty", () => {
      const executor = {
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
                  condition: {
                    expr: "args.newRecord.total > 0",
                  },
                },
              },
            },
          },
        },
        targetType: ExecutorTargetType.FUNCTION,
        disabled: false,
      } as ExecutorExecutor;

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
      const executor = {
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
        targetType: ExecutorTargetType.FUNCTION,
        disabled: false,
      } as ExecutorExecutor;

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
      const executor = {
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
        targetType: ExecutorTargetType.FUNCTION,
        disabled: false,
      } as ExecutorExecutor;

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

      expect(result.triggerConfig).toEqual({ secret: "***" });
      expect(result.targetConfig).toEqual({ url: '"https://example.com/webhook"', headers: 1 });
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
              typedConfig: { case: undefined },
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

      expect(result.targetConfig).toEqual({ workflowName: "order-processing" });
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

      expect(result.triggerConfig).toEqual({});
      expect(result.targetConfig).toEqual({});
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

      expect(result.triggerConfig).toEqual({});
      expect(result.targetConfig).toEqual({});
    });
  });
});
