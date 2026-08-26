import { describe, expect, test, vi } from "vitest";
import { fetchMissingDependentApps } from "./dependency-records";
import type { Application } from "#/cli/services/application";
import type { OperatorClient } from "#/cli/shared/client";

const workspaceId = "ws";
const buyer = "0191b0f4-1c4e-7d3a-9f2b-8c5a4e6d7b81";
const buyerKey = `sdk-depended-by-app-${buyer}`;

type AppSpec = {
  types?: Record<string, boolean | undefined>;
  resolvers?: Record<string, boolean | undefined>;
  idps?: Record<string, boolean | undefined>;
  workflows?: Record<string, boolean | undefined>;
  jobs?: Record<string, boolean | undefined>;
};

function application(spec: AppSpec): Readonly<Application> {
  const settings = (publishEvents: boolean | undefined) => ({ settings: { publishEvents } });
  return {
    name: "supplier",
    tailorDBServices: [
      {
        namespace: "db",
        types: Object.fromEntries(
          Object.entries(spec.types ?? {}).map(([name, pinned]) => [name, settings(pinned)]),
        ),
      },
    ],
    resolverServices: [
      {
        namespace: "pipeline",
        resolvers: Object.fromEntries(
          Object.entries(spec.resolvers ?? {}).map(([name, publishEvents]) => [
            name,
            { name, publishEvents },
          ]),
        ),
      },
    ],
    idpServices: Object.entries(spec.idps ?? {}).map(([name, publishEvents]) => ({
      name,
      publishEvents,
    })),
    workflowService: {
      workflows: Object.fromEntries(
        Object.entries(spec.workflows ?? {}).map(([name, publishEvents]) => [
          name,
          { name, publishEvents, mainJob: { name: `${name}-main` } },
        ]),
      ),
      jobs: Object.entries(spec.jobs ?? {}).map(([name, publishEvents]) => ({
        name,
        publishEvents,
      })),
    },
  } as unknown as Readonly<Application>;
}

/**
 * A client whose named TRNs each carry one record for `buyer`.
 * @param trns - TRNs that answer with a record
 * @param scope - Which namespace the record sits in
 * @returns Operator client stub exposing its getMetadata mock
 */
function clientRecording(
  trns: string[],
  scope: "resource" | "jobs" = "resource",
): OperatorClient & { getMetadata: ReturnType<typeof vi.fn> } {
  const set = new Set(trns);
  const key = scope === "jobs" ? `sdk-job-depended-by-app-${buyer}` : buyerKey;
  return {
    getMetadata: vi
      .fn()
      .mockImplementation(({ trn }: { trn: string }) =>
        set.has(trn) ? { metadata: { labels: { [key]: "publish-events" } } } : {},
      ),
  } as unknown as OperatorClient & { getMetadata: ReturnType<typeof vi.fn> };
}

describe("fetchMissingDependentApps", () => {
  test("reads a TailorDB table's own TRN, not the application's", async () => {
    // The application TRN embeds the app name, so a record there is missed the
    // moment the config is renamed. The table's TRN does not.
    const client = clientRecording([`trn:v1:workspace:ws:tailordb:db:type:Order`]);

    const missing = await fetchMissingDependentApps({
      client,
      workspaceId,
      application: application({ types: { Order: undefined } }),
      runAppIds: new Set(),
      subscribedKeys: new Set(),
      jobsByWorkflow: { "nightly-main": ["process-order"] },
    });

    expect(missing).toEqual([
      { resource: 'TailorDB table "Order"', appId: buyer, reason: "publish-events" },
    ]);
    expect(client.getMetadata.mock.calls.map((call) => call[0].trn)).not.toContain(
      "trn:v1:workspace:ws:application:supplier",
    );
  });

  test("skips a resource that declares publishEvents", async () => {
    // Its value is not recomputed, so an absent config cannot change it and a
    // record on it could only prompt about something that cannot happen.
    const client = clientRecording([`trn:v1:workspace:ws:tailordb:db:type:Order`]);

    const missing = await fetchMissingDependentApps({
      client,
      workspaceId,
      application: application({ types: { Order: true } }),
      runAppIds: new Set(),
      subscribedKeys: new Set(),
      jobsByWorkflow: { "nightly-main": ["process-order"] },
    });

    expect(missing).toEqual([]);
    expect(client.getMetadata).not.toHaveBeenCalled();
  });

  test("ignores a record for an application taking part in the run", async () => {
    const client = clientRecording([`trn:v1:workspace:ws:workflow:nightly`]);

    const missing = await fetchMissingDependentApps({
      client,
      workspaceId,
      application: application({ workflows: { nightly: undefined } }),
      runAppIds: new Set([buyer]),
      subscribedKeys: new Set(),
      jobsByWorkflow: { "nightly-main": ["process-order"] },
    });

    expect(missing).toEqual([]);
  });

  test("reads a pinned workflow's job records while any job leaves the value unset", async () => {
    // The jobs' value is driven by workflowJobExecution subscribers, so the
    // workflow's own declaration does not settle whether their records matter.
    const client = clientRecording([`trn:v1:workspace:ws:workflow:nightly`], "jobs");

    const missing = await fetchMissingDependentApps({
      client,
      workspaceId,
      application: application({
        workflows: { nightly: true },
        jobs: { "process-order": undefined },
      }),
      runAppIds: new Set(),
      subscribedKeys: new Set(),
      jobsByWorkflow: { "nightly-main": ["process-order"] },
    });

    expect(missing).toEqual([
      { resource: 'Jobs of workflow "nightly"', appId: buyer, reason: "publish-events" },
    ]);
  });

  test.each([
    [
      "resolver",
      { resolvers: { processOrder: undefined } },
      "trn:v1:workspace:ws:pipeline:pipeline:resolver:processOrder",
      'Resolver "processOrder"',
    ],
    [
      "IdP",
      { idps: { "shared-idp": undefined } },
      "trn:v1:workspace:ws:idp:shared-idp",
      'IdP service "shared-idp"',
    ],
  ])("reads a %s through its own TRN", async (_kind, spec, trn, label) => {
    const missing = await fetchMissingDependentApps({
      client: clientRecording([trn]),
      workspaceId,
      application: application(spec),
      runAppIds: new Set(),
      subscribedKeys: new Set(),
      jobsByWorkflow: { "nightly-main": ["process-order"] },
    });

    expect(missing).toEqual([{ resource: label, appId: buyer, reason: "publish-events" }]);
  });
});

describe("fetchMissingDependentApps and the run's own subscribers", () => {
  test("skips a resource this run still subscribes to", async () => {
    // Its value resolves to true from the run's own executor, so the absent
    // config changes nothing and the confirmation would ask about a change that
    // cannot happen.
    const client = clientRecording(["trn:v1:workspace:ws:tailordb:db:type:Order"]);

    const missing = await fetchMissingDependentApps({
      client,
      workspaceId,
      application: application({ types: { Order: undefined } }),
      runAppIds: new Set(),
      subscribedKeys: new Set(["tailordb:db:type:Order"]),
      jobsByWorkflow: { "nightly-main": ["process-order"] },
    });

    expect(missing).toEqual([]);
    expect(client.getMetadata).not.toHaveBeenCalled();
  });

  test("still reports a resource nothing in the run subscribes to", async () => {
    const client = clientRecording(["trn:v1:workspace:ws:tailordb:db:type:Order"]);

    const missing = await fetchMissingDependentApps({
      client,
      workspaceId,
      application: application({ types: { Order: undefined } }),
      runAppIds: new Set(),
      subscribedKeys: new Set(["tailordb:db:type:Invoice"]),
      jobsByWorkflow: { "nightly-main": ["process-order"] },
    });

    expect(missing).toHaveLength(1);
  });
});

describe("fetchMissingDependentApps and the two values a workflow carries", () => {
  test("still reports the job records while only the workflow's own value is subscribed", async () => {
    // A workflowExecution subscriber keeps the workflow's own events on, but says
    // nothing about the jobs — their value is driven by workflowJobExecution
    // subscribers, and all of those are absent here.
    const client = clientRecording(["trn:v1:workspace:ws:workflow:nightly"], "jobs");

    const missing = await fetchMissingDependentApps({
      client,
      workspaceId,
      application: application({
        workflows: { nightly: undefined },
        jobs: { "process-order": undefined },
      }),
      runAppIds: new Set(),
      subscribedKeys: new Set(["workflow:nightly"]),
      jobsByWorkflow: { "nightly-main": ["process-order"] },
    });

    expect(missing).toEqual([
      { resource: 'Jobs of workflow "nightly"', appId: buyer, reason: "publish-events" },
    ]);
  });

  test("skips the job records once the jobs themselves are subscribed in the run", async () => {
    const client = clientRecording(["trn:v1:workspace:ws:workflow:nightly"], "jobs");

    const missing = await fetchMissingDependentApps({
      client,
      workspaceId,
      application: application({
        workflows: { nightly: true },
        jobs: { "process-order": undefined },
      }),
      runAppIds: new Set(),
      subscribedKeys: new Set(["workflow:nightly:jobs"]),
      jobsByWorkflow: { "nightly-main": ["process-order"] },
    });

    expect(missing).toEqual([]);
  });
});

describe("fetchMissingDependentApps and which jobs a workflow runs", () => {
  const base = {
    workspaceId,
    runAppIds: new Set<string>(),
    subscribedKeys: new Set<string>(),
  };

  test("asks about the job records only for a workflow that runs an unset job", async () => {
    // Another workflow's unset job says nothing about this one. Asking across
    // every job in the config prompts about a workflow the owner cannot act on.
    const client = clientRecording(["trn:v1:workspace:ws:workflow:pinned-jobs"], "jobs");

    const missing = await fetchMissingDependentApps({
      ...base,
      client,
      application: application({
        workflows: { "pinned-jobs": undefined },
        jobs: { "declared-job": true, "unset-job": undefined },
      }),
      jobsByWorkflow: { "pinned-jobs-main": ["declared-job"] },
    });

    expect(missing.map((entry) => entry.resource)).not.toContain('Jobs of workflow "pinned-jobs"');
  });

  test("asks once the workflow does run an unset job", async () => {
    const client = clientRecording(["trn:v1:workspace:ws:workflow:runs-unset"], "jobs");

    const missing = await fetchMissingDependentApps({
      ...base,
      client,
      application: application({
        workflows: { "runs-unset": true },
        jobs: { "declared-job": true, "unset-job": undefined },
      }),
      jobsByWorkflow: { "runs-unset-main": ["declared-job", "unset-job"] },
    });

    expect(missing.map((entry) => entry.resource)).toContain('Jobs of workflow "runs-unset"');
  });
});

describe("fetchMissingDependentApps and a job two workflows share", () => {
  test("skips the job records of a workflow whose jobs a subscribed peer keeps on", () => {
    // Job values are resolved per job name from the union of subscribed workflows,
    // so a job "shared" runs by both workflows stays on while this run subscribes
    // to "watched". Reporting "quiet"'s record would prompt about a value that
    // does not turn off.
    const client = clientRecording(["trn:v1:workspace:ws:workflow:quiet"], "jobs");

    return expect(
      fetchMissingDependentApps({
        client,
        workspaceId,
        application: application({
          workflows: { quiet: true, watched: true },
          jobs: { shared: undefined },
        }),
        runAppIds: new Set(),
        subscribedKeys: new Set(["workflow:watched:jobs"]),
        jobsByWorkflow: { "quiet-main": ["shared"], "watched-main": ["shared"] },
      }),
    ).resolves.toEqual([]);
  });

  test("still reports the job records when no subscribed workflow runs the unset job", () => {
    const client = clientRecording(["trn:v1:workspace:ws:workflow:quiet"], "jobs");

    return expect(
      fetchMissingDependentApps({
        client,
        workspaceId,
        application: application({
          workflows: { quiet: true, watched: true },
          jobs: { "quiet-only": undefined, "watched-only": undefined },
        }),
        runAppIds: new Set(),
        subscribedKeys: new Set(["workflow:watched:jobs"]),
        jobsByWorkflow: { "quiet-main": ["quiet-only"], "watched-main": ["watched-only"] },
      }),
    ).resolves.toEqual([
      { resource: 'Jobs of workflow "quiet"', appId: buyer, reason: "publish-events" },
    ]);
  });
});
