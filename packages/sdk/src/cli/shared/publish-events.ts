/** Resource and trigger named in a `publishEvents` opt-out conflict error. */
export type PublishEventsConflict = {
  /** Resource named in the error, e.g. `TailorDB table "Order"`. */
  resource: string;
  /** Executor trigger family named in the error, e.g. `record`. */
  trigger: string;
  /** What the subscribing executors subscribe to. Defaults to `"it"`. */
  subscribesTo?: string;
};

/**
 * How each event-publishing resource is named in user-facing messages.
 *
 * Every message naming one of these reads from here, so a conflict error and the
 * confirmation that lists the same resource cannot drift apart.
 */
export const eventSourceLabel = {
  tailorDBType: (name: string) => `TailorDB table "${name}"`,
  resolver: (name: string) => `Resolver "${name}"`,
  idpService: (name: string) => `IdP service "${name}"`,
  workflow: (name: string) => `Workflow "${name}"`,
  workflowJob: (name: string) => `Job "${name}"`,
  workflowJobs: (workflowName: string) => `Jobs of workflow "${workflowName}"`,
} as const;

/** Opt-out conflict details per event-publishing resource. */
export const publishEventsConflict = {
  tailorDBType: (name: string): PublishEventsConflict => ({
    resource: eventSourceLabel.tailorDBType(name),
    trigger: "record",
  }),
  resolver: (name: string): PublishEventsConflict => ({
    resource: eventSourceLabel.resolver(name),
    trigger: "resolverExecuted",
  }),
  idpService: (name: string): PublishEventsConflict => ({
    resource: eventSourceLabel.idpService(name),
    trigger: "idpUser",
  }),
  workflow: (name: string): PublishEventsConflict => ({
    resource: eventSourceLabel.workflow(name),
    trigger: "workflowExecution",
  }),
  workflowJob: (name: string): PublishEventsConflict => ({
    resource: eventSourceLabel.workflowJob(name),
    trigger: "workflowJobExecution",
    subscribesTo: "a workflow that runs it",
  }),
} as const;

/**
 * Build the error raised when a resource opts out of publishing that a
 * subscribing executor needs.
 * @param conflict - Resource, trigger, and subscription target named in the error
 * @returns Error message
 */
function publishEventsConflictError(conflict: PublishEventsConflict): string {
  const { resource, trigger, subscribesTo = "it" } = conflict;
  return (
    `${resource} has "publishEvents: false", but executors with ${trigger} triggers subscribe to ${subscribesTo}. ` +
    `Either remove "publishEvents: false" or remove the matching executor triggers.`
  );
}

/** The part of an executor that decides whether its triggers need events. */
export type EventSubscribingExecutor = {
  /** Whether the executor is disabled, i.e. deployed but never run. */
  disabled?: boolean | undefined;
};

/**
 * Whether an executor's triggers count toward the resources it subscribes to.
 *
 * A disabled executor never runs, so it needs no events: counting one would keep
 * publishing enabled on the resource its trigger names, and would reject an
 * explicit `publishEvents: false` that nothing actually contradicts.
 * @param executor - Executor declared by the subscribing config
 * @returns Whether the executor's triggers subscribe to anything
 */
export function subscribesToEvents(executor: EventSubscribingExecutor): boolean {
  return !executor.disabled;
}

/** Inputs deciding whether a resource publishes events. */
export type ResolvePublishEventsParams = {
  /** `publishEvents` declared on the resource, or undefined when unset. */
  explicit: boolean | undefined;
  /** Whether an executor taking part in the same run subscribes to it. */
  subscribed: boolean;
  /** Resource and trigger named when an opt-out conflicts with a subscriber. */
  conflict: PublishEventsConflict;
};

/**
 * Reject an opt-out that a subscribing executor contradicts.
 *
 * Separate from {@link resolvePublishEvents} so a planner can reject the whole
 * config before issuing any request, rather than partway through.
 * @param params - Declared value, subscriber presence, and conflict error details
 */
export function assertNoPublishEventsConflict(params: ResolvePublishEventsParams): void {
  const { explicit, subscribed, conflict } = params;
  if (explicit === false && subscribed) {
    throw new Error(publishEventsConflictError(conflict));
  }
}

/**
 * Resolve whether a resource publishes events.
 *
 * An unset value is recomputed from the executors taking part in the run, so
 * removing the last subscribing trigger turns publishing back off. A `deploy`
 * covering several configs counts a subscriber in any of them, so a resource
 * shared across configs needs `publishEvents: true` on the resource itself only
 * to keep publishing when the subscribing config is deployed on its own.
 * @param params - Declared value, subscriber presence, and conflict error details
 * @returns Whether the resource publishes events
 */
export function resolvePublishEvents(params: ResolvePublishEventsParams): boolean {
  assertNoPublishEventsConflict(params);
  return params.explicit ?? params.subscribed;
}
