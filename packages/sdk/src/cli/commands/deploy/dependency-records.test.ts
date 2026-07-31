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
          { name, publishEvents },
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
 * @returns Operator client stub exposing its getMetadata mock
 */
function clientRecording(
  trns: string[],
): OperatorClient & { getMetadata: ReturnType<typeof vi.fn> } {
  const set = new Set(trns);
  return {
    getMetadata: vi
      .fn()
      .mockImplementation(({ trn }: { trn: string }) =>
        set.has(trn) ? { metadata: { labels: { [buyerKey]: "publish-events" } } } : {},
      ),
  } as unknown as OperatorClient & { getMetadata: ReturnType<typeof vi.fn> };
}

describe("fetchMissingDependentApps", () => {
  test("reads a TailorDB type's own TRN, not the application's", async () => {
    // The application TRN embeds the app name, so a record there is missed the
    // moment the config is renamed. The type's TRN does not.
    const client = clientRecording([`trn:v1:workspace:ws:tailordb:db:type:Order`]);

    const missing = await fetchMissingDependentApps({
      client,
      workspaceId,
      application: application({ types: { Order: undefined } }),
      runAppIds: new Set(),
      subscribedKeys: new Set(),
    });

    expect(missing).toEqual([
      { resource: 'TailorDB type "Order"', appId: buyer, reason: "publish-events" },
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
    });

    expect(missing).toEqual([]);
  });

  test("reads a pinned workflow while any of its jobs leaves the value unset", async () => {
    // A workflowJobExecution trigger records on the workflow, so the workflow's
    // own declaration does not settle whether its records still matter.
    const client = clientRecording([`trn:v1:workspace:ws:workflow:nightly`]);

    const missing = await fetchMissingDependentApps({
      client,
      workspaceId,
      application: application({
        workflows: { nightly: true },
        jobs: { "process-order": undefined },
      }),
      runAppIds: new Set(),
      subscribedKeys: new Set(),
    });

    expect(missing).toEqual([
      { resource: 'Workflow "nightly"', appId: buyer, reason: "publish-events" },
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
    });

    expect(missing).toHaveLength(1);
  });
});
