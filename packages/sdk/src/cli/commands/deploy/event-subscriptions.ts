import { eventSourceLabel, publishEventsConflict } from "#/cli/shared/publish-events";
import { collectApplicationIdpNames, findResolverNamespace } from "./executor";
import { dependedByAppLabelKey, eventSourceKey } from "./label";
import {
  collectVisibleIdpNames,
  collectVisibleResolverNamespaces,
  collectVisibleTailorDBTypeNamespaces,
} from "./visible-resources";
import type { Application } from "#/cli/services/application";
import type { Executor } from "#/types/executor.generated";
import type { BuiltDeploymentTarget } from "./deployment-target";
import type { DependentAppsByResource, DeployDependencyReason } from "./label";
import type { WorkflowEventSubscribers } from "./workflow";

/**
 * Resolve which IdP an `idpUser` trigger subscribes to. A trigger that omits the
 * `idp` option means the only configured IdP; when several exist the target is
 * ambiguous and the apply pipeline throws a clearer error for it later.
 * @param application - Application declaring the executor
 * @param trigger - The executor's `idpUser` trigger
 * @returns The subscribed IdP name, or undefined when ambiguous
 */
function subscribedIdpName(
  application: Readonly<Application>,
  trigger: { idp?: string | undefined },
): string | undefined {
  if (trigger.idp != null) {
    return trigger.idp;
  }
  const idps = collectApplicationIdpNames(application);
  if (idps.size !== 1) {
    return undefined;
  }
  const [only] = idps;
  return only;
}

/** What one executor's event trigger subscribes to, and who declares it. */
export type EventSubscription = {
  /** Target declaring the executor. */
  subscriber: BuiltDeploymentTarget;
  /** Name of the subscribing executor, for error messages. */
  executorName: string;
  /** Target declaring the subscribed resource. */
  owner: BuiltDeploymentTarget;
  /** The subscribed resource, named as error messages name it. */
  resource: string;
  /** Stable identity of the subscribed resource, keying its dependency records. */
  key: string | undefined;
  /**
   * Whether the owner declares `publishEvents` on the subscribed resource, which
   * pins the value and leaves nothing for a dependency record to protect.
   */
  pinned: boolean;
  /** The executor's trigger, narrowed to a kind that names a publishing resource. */
  trigger: PublishingTrigger;
};

/**
 * Build the error for a subscription whose resource no config in the run declares.
 *
 * The advice differs by cause: a config that declares the resource as owned
 * elsewhere is missing its peer from `--config`, while one that declares nothing
 * external is naming a resource that does not exist.
 * @param executorName - Name of the subscribing executor
 * @param lookup - How the subscribed resource is found
 * @param subscriber - Deployment target declaring the executor
 * @returns Error message
 */
function missingOwnerMessage(
  executorName: string,
  lookup: EventSourceLookup,
  subscriber: BuiltDeploymentTarget,
): string {
  const subject = `Executor "${executorName}" subscribes to ${lookup.resource}, which no config in this deploy declares.`;
  const external = lookup.externalHint(subscriber);
  if (external) {
    return `${subject} This config declares ${external}, so add the config that owns it to --config.`;
  }
  if (
    lookup.trigger.kind === "workflowExecution" ||
    lookup.trigger.kind === "workflowJobExecution"
  ) {
    return (
      `${subject} A workflow has no "external" declaration, unlike a TailorDB namespace or resolver, so ` +
      `nothing in this config points at the one that owns it. Check the name, or add the config that ` +
      `declares the workflow to --config.`
    );
  }
  return `${subject} This config declares nothing external that could hold it, so check the name.`;
}

/**
 * Resolve every event subscription in the run to the config that declares the
 * subscribed resource.
 *
 * Doing this once keeps the flags the planners resolve and the cross-config
 * dependencies recorded on the application in agreement — both are read off the
 * same list.
 * @param targets - Built deployment targets in the run
 * @returns One entry per executor whose trigger names a publishing resource
 */
export function collectEventSubscriptions(
  targets: ReadonlyArray<BuiltDeploymentTarget>,
): EventSubscription[] {
  const subscriptions: EventSubscription[] = [];
  const applications = targets.map((target) => target.application);
  for (const subscriber of targets) {
    const executors = subscriber.application.executorService?.executors ?? {};
    const visibility = collectSubscriberVisibility(subscriber, applications);
    for (const executor of Object.values(executors)) {
      const lookup = eventSourceLookup(executor, subscriber, visibility);
      if (!lookup) {
        continue;
      }
      const entry = {
        subscriber,
        executorName: executor.name,
        resource: lookup.resource,
        trigger: lookup.trigger,
      };
      if (lookup.declaredBy(subscriber)) {
        subscriptions.push({
          ...entry,
          owner: subscriber,
          pinned: lookup.pinned(subscriber),
          key: lookup.keyIn(subscriber),
        });
        continue;
      }
      const peers = targets.filter(
        (target) => target.config.path !== subscriber.config.path && lookup.declaredBy(target),
      );
      const owners = lookup.narrowOwners(peers);
      // The subscriber sees the name in more than one namespace. Which one the
      // trigger means is reported when the executor's namespace is resolved.
      if (owners === "ambiguous") {
        continue;
      }
      const [owner] = owners;
      if (!owner) {
        throw new Error(missingOwnerMessage(executor.name, lookup, subscriber));
      }
      subscriptions.push({
        ...entry,
        owner,
        pinned: lookup.pinned(owner),
        key: lookup.keyIn(owner),
      });
    }
  }
  return subscriptions;
}

/**
 * Key the resources this run subscribes to among the target's own.
 *
 * A resource with a subscriber in the run resolves to `true` from that subscriber
 * alone, so no absent config can change it.
 * @param subscriptions - Subscriptions resolved across the run
 * @param owner - Deployment target being planned
 * @returns Resource keys the run subscribes to
 */
export function subscribedResourceKeys(
  subscriptions: ReadonlyArray<EventSubscription>,
  owner: BuiltDeploymentTarget,
): ReadonlySet<string> {
  return new Set(
    ownedSubscriptions(subscriptions, owner).flatMap((subscription) => subscription.key ?? []),
  );
}

/**
 * Select the subscriptions pointing at resources the given target declares.
 * @param subscriptions - Subscriptions resolved across the run
 * @param owner - Deployment target being planned
 * @returns Subscriptions whose subscribed resource belongs to `owner`
 */
export function ownedSubscriptions(
  subscriptions: ReadonlyArray<EventSubscription>,
  owner: BuiltDeploymentTarget,
): EventSubscription[] {
  return subscriptions.filter(
    (subscription) => subscription.owner.config.path === owner.config.path,
  );
}

/**
 * Collect the TailorDB tables subscribed to among the given subscriptions.
 * @param subscriptions - Subscriptions owned by the target being planned
 * @returns Subscribed table names
 */
export function subscribedTailorDBTypes(
  subscriptions: ReadonlyArray<EventSubscription>,
): ReadonlySet<string> {
  return new Set(
    subscriptions.flatMap((subscription) =>
      subscription.trigger.kind === "tailordb" ? [subscription.trigger.typeName] : [],
    ),
  );
}

/**
 * Collect the resolvers subscribed to among the given subscriptions.
 * @param subscriptions - Subscriptions owned by the target being planned
 * @returns Subscribed resolver names
 */
export function subscribedResolvers(
  subscriptions: ReadonlyArray<EventSubscription>,
): ReadonlySet<string> {
  return new Set(
    subscriptions.flatMap((subscription) =>
      subscription.trigger.kind === "resolverExecuted" ? [subscription.trigger.resolverName] : [],
    ),
  );
}

/**
 * Collect the IdPs subscribed to among the given subscriptions.
 * @param subscriptions - Subscriptions owned by the target being planned
 * @returns Subscribed IdP names
 */
export function subscribedIdps(
  subscriptions: ReadonlyArray<EventSubscription>,
): ReadonlySet<string> {
  return new Set(
    subscriptions.flatMap((subscription) =>
      subscription.trigger.kind === "idpUser"
        ? [
            subscribedIdpName(subscription.subscriber.application, subscription.trigger) ?? [],
          ].flat()
        : [],
    ),
  );
}

/**
 * Collect the workflows subscribed to, per event granularity level.
 * @param subscriptions - Subscriptions owned by the target being planned
 * @returns Subscribers keyed by event granularity level
 */
export function subscribedWorkflows(subscriptions: ReadonlyArray<EventSubscription>): {
  execution: WorkflowEventSubscribers;
  jobExecution: WorkflowEventSubscribers;
} {
  const execution = { workflowNames: new Set<string>() };
  const jobExecution = { workflowNames: new Set<string>() };
  for (const { trigger } of subscriptions) {
    if (trigger.kind === "workflowExecution") {
      execution.workflowNames.add(trigger.workflowName);
    } else if (trigger.kind === "workflowJobExecution") {
      jobExecution.workflowNames.add(trigger.workflowName);
    }
  }
  return { execution, jobExecution };
}

/**
 * Collect the applications that have to take part in the same deploy for this
 * target's resources to be applied the same way.
 *
 * An executor in another config makes the resource it subscribes to publish
 * events, so deploying this config without that one would resolve the flag from
 * a smaller set of executors and turn publishing off.
 *
 * A resource that declares `publishEvents` keeps its value either way, so
 * recording a dependency for it would ask about a partial deploy that changes
 * nothing — and `prompt.confirm` rejects outright where it cannot ask, failing a
 * deploy that was never at risk.
 *
 * Records are keyed by resource rather than by application: the resource is what
 * carries them, so a record survives the owner being renamed and disappears with
 * the resource itself.
 * @param subscriptions - Subscriptions owned by the target being planned
 * @returns Dependent application ids and reasons, keyed by resource
 */
export function collectDependentApps(
  subscriptions: ReadonlyArray<EventSubscription>,
): DependentAppsByResource {
  const byResource = new Map<string, Map<string, DeployDependencyReason>>();
  for (const { subscriber, owner, pinned, key } of subscriptions) {
    if (subscriber.config.path === owner.config.path || pinned || key === undefined) {
      continue;
    }
    const appId = subscriber.application.id;
    if (appId === undefined) {
      continue;
    }
    const dependents = byResource.get(key) ?? new Map<string, DeployDependencyReason>();
    dependents.set(appId, "publish-events");
    byResource.set(key, dependents);
  }
  return byResource;
}

/**
 * Collect explicit `publishEvents` values declared on this target's workflow jobs.
 * @param target - Deployment target being planned
 * @returns Explicit flags keyed by job name
 */
export function collectWorkflowJobPublishEvents(
  target: BuiltDeploymentTarget,
): ReadonlyMap<string, boolean> {
  const jobPublishEvents = new Map<string, boolean>();
  for (const job of target.application.workflowService?.jobs ?? []) {
    if (job.publishEvents !== undefined) {
      jobPublishEvents.set(job.name, job.publishEvents);
    }
  }
  return jobPublishEvents;
}

/** Executor trigger kinds that name a resource which publishes events. */
type PublishingTrigger = Extract<
  Executor["trigger"],
  {
    kind:
      | "tailordb"
      | "resolverExecuted"
      | "idpUser"
      | "workflowExecution"
      | "workflowJobExecution";
  }
>;

/**
 * What one subscribing config can see, in the same terms the executor's own
 * namespace resolution uses. A namespace maps to `undefined` when the subscriber
 * sees the name in more than one place.
 */
type SubscriberVisibility = {
  tailorDBTypes: ReadonlyMap<string, string | undefined>;
  resolvers: ReadonlyMap<string, string | undefined>;
  idps: ReadonlySet<string>;
};

function collectSubscriberVisibility(
  subscriber: BuiltDeploymentTarget,
  applications: ReadonlyArray<Readonly<Application>>,
): SubscriberVisibility {
  return {
    tailorDBTypes: collectVisibleTailorDBTypeNamespaces(subscriber.application, applications),
    resolvers: collectVisibleResolverNamespaces(subscriber.application, applications),
    idps: collectVisibleIdpNames(subscriber.application, applications),
  };
}

/** Candidate owners the subscriber's view leaves, or that it cannot tell apart. */
type OwnerCandidates = BuiltDeploymentTarget[] | "ambiguous";

/** How to find one event-publishing resource in a deployment target. */
type EventSourceLookup = {
  /** Resource named in error messages, e.g. `TailorDB table "Order"`. */
  resource: string;
  /** The trigger, narrowed to a kind that names a publishing resource. */
  trigger: PublishingTrigger;
  /** Whether `target` declares the resource. */
  declaredBy: (target: BuiltDeploymentTarget) => boolean | undefined;
  /**
   * Whether `target` declares `publishEvents` on the resource, so the value does
   * not depend on which configs the run covers.
   */
  pinned: (target: BuiltDeploymentTarget) => boolean;
  /**
   * Stable identity of the subscribed resource inside its owner, used to key the
   * dependency records. Undefined when the owner does not declare it after all.
   */
  keyIn: (owner: BuiltDeploymentTarget) => string | undefined;
  /**
   * Narrow peer configs to the ones the subscriber's own view resolves to.
   *
   * Matching on the name alone would count a same-named resource in a namespace
   * the subscriber cannot see, and drop the subscription as ambiguous even though
   * the executor resolves it to exactly one owner.
   */
  narrowOwners: (candidates: ReadonlyArray<BuiltDeploymentTarget>) => OwnerCandidates;
  /**
   * What `target` declares as owned elsewhere that could hold this resource,
   * described for an error message. Undefined for a resource kind that cannot be
   * referenced from another config at all.
   */
  externalHint: (target: BuiltDeploymentTarget) => string | undefined;
};

/**
 * TailorDB namespaces the config declares as owned elsewhere.
 * @param target - Deployment target declaring the executor
 * @returns Namespace names declared with `external: true`
 */
function externalTailorDBNamespaces(target: BuiltDeploymentTarget): ReadonlyArray<string> {
  return target.application.externalTailorDBNamespaces;
}

function externalSubgraphNames(
  target: BuiltDeploymentTarget,
  subgraphType: string,
  localNames: ReadonlySet<string>,
): string[] {
  return target.application.subgraphs
    .filter((subgraph) => subgraph.Type === subgraphType && !localNames.has(subgraph.Name))
    .map((subgraph) => subgraph.Name);
}

function externalResolverNamespaces(target: BuiltDeploymentTarget): string[] {
  const local = new Set(target.application.resolverServices.map((service) => service.namespace));
  return externalSubgraphNames(target, "pipeline", local);
}

function externalIdpNames(target: BuiltDeploymentTarget): string[] {
  const local = new Set(target.application.idpServices.map((idp) => idp.name));
  return externalSubgraphNames(target, "idp", local);
}

/**
 * Describe the external declarations that could hold a missing resource.
 * @param kind - Resource kind named in the message, e.g. `TailorDB namespace`
 * @param names - External names the subscribing config declares
 * @returns A phrase for the error message, or undefined when it declares none
 */
function describeExternal(kind: string, names: ReadonlyArray<string>): string | undefined {
  if (names.length === 0) {
    return undefined;
  }
  const plural = names.length === 1 ? kind : `${kind}s`;
  return `external ${plural} ${names.map((name) => `"${name}"`).join(", ")}`;
}

function declaresTailorDBType(
  target: BuiltDeploymentTarget,
  typeName: string,
): boolean | undefined {
  return (
    target.application.tailorDBServices.some((service) => service.types[typeName]) || undefined
  );
}

function declaresResolver(
  target: BuiltDeploymentTarget,
  resolverName: string,
): boolean | undefined {
  return (
    target.application.resolverServices.some((service) =>
      Object.values(service.resolvers).some((resolver) => resolver.name === resolverName),
    ) || undefined
  );
}

function declaresIdp(target: BuiltDeploymentTarget, idpName: string): boolean | undefined {
  return target.application.idpServices.some((entry) => entry.name === idpName) || undefined;
}

function declaresWorkflow(
  target: BuiltDeploymentTarget,
  workflowName: string,
): boolean | undefined {
  const workflows = Object.values(target.application.workflowService?.workflows ?? {});
  return workflows.some((entry) => entry.name === workflowName) || undefined;
}

// A resource that declares publishEvents keeps that value whatever the run covers,
// so nothing about it needs recording. An explicit `false` with a subscriber is
// rejected by assertNoPublishEventsConflict, which explains that case on its own.
function pinsTailorDBType(target: BuiltDeploymentTarget, typeName: string): boolean {
  for (const service of target.application.tailorDBServices) {
    const type = service.types[typeName];
    if (type) return type.settings.publishEvents !== undefined;
  }
  return false;
}

// Resolver names are only namespace-unique, so the namespace the subscriber sees
// the name through is what decides which resolver's declared value applies.
// Searching every namespace would let one namespace's declaration pin another's.
function pinsResolverIn(
  target: BuiltDeploymentTarget,
  namespace: string,
  resolverName: string,
): boolean {
  return target.application.resolverServices.some(
    (service) =>
      service.namespace === namespace &&
      Object.values(service.resolvers).some(
        (resolver) => resolver.name === resolverName && resolver.publishEvents !== undefined,
      ),
  );
}

function pinsIdp(target: BuiltDeploymentTarget, idpName: string): boolean {
  return target.application.idpServices.some(
    (entry) => entry.name === idpName && entry.publishEvents !== undefined,
  );
}

function pinsWorkflow(target: BuiltDeploymentTarget, workflowName: string): boolean {
  return Object.values(target.application.workflowService?.workflows ?? {}).some(
    (entry) => entry.name === workflowName && entry.publishEvents !== undefined,
  );
}

// A workflowJobExecution trigger enables publishing on the jobs the subscribed
// workflow runs, so only those decide whether the value is declared. Reading the
// whole config's jobs instead would call the value unset because some other
// workflow leaves one unset, and `planWorkflow` writes the records per workflow.
function pinsEveryJobOfWorkflow(target: BuiltDeploymentTarget, workflowName: string): boolean {
  const workflow = Object.values(target.application.workflowService?.workflows ?? {}).find(
    (entry) => entry.name === workflowName,
  );
  if (workflow === undefined) return false;
  const jobNames = target.workflowBuildResult?.mainJobDeps[workflow.mainJob.name] ?? [];
  const declared = collectWorkflowJobPublishEvents(target);
  return jobNames.length > 0 && jobNames.every((jobName) => declared.has(jobName));
}

function tailorDBTypeNamespaceIn(
  target: BuiltDeploymentTarget,
  typeName: string,
): string | undefined {
  return target.application.tailorDBServices.find((service) => service.types[typeName])?.namespace;
}

// A namespaced resource is owned by whichever config declares it in the one
// namespace the subscriber sees it through. An absent key means the subscriber
// cannot see the name at all, which the missing-owner error explains.
function narrowByVisibleNamespace(params: {
  candidates: ReadonlyArray<BuiltDeploymentTarget>;
  visible: ReadonlyMap<string, string | undefined>;
  resourceKey: string;
  declaresIn: (target: BuiltDeploymentTarget, namespace: string) => boolean;
}): OwnerCandidates {
  const { candidates, visible, resourceKey, declaresIn } = params;
  if (!visible.has(resourceKey)) return [];
  const namespace = visible.get(resourceKey);
  if (namespace === undefined) return "ambiguous";
  return candidates.filter((target) => declaresIn(target, namespace));
}

function declaresTailorDBTypeIn(
  target: BuiltDeploymentTarget,
  namespace: string,
  typeName: string,
): boolean {
  return target.application.tailorDBServices.some(
    (service) => service.namespace === namespace && Boolean(service.types[typeName]),
  );
}

function declaresResolverIn(
  target: BuiltDeploymentTarget,
  namespace: string,
  resolverName: string,
): boolean {
  return target.application.resolverServices.some(
    (service) =>
      service.namespace === namespace &&
      Object.values(service.resolvers).some((resolver) => resolver.name === resolverName),
  );
}

/**
 * Resolve how to find the resource an executor's event trigger subscribes to.
 * @param executor - Executor declared by the subscribing config
 * @param subscriber - Deployment target declaring the executor
 * @param visibility - What the subscribing config can see, by resource kind
 * @returns The lookup, or undefined for triggers with no publishing resource
 */
function eventSourceLookup(
  executor: Executor,
  subscriber: BuiltDeploymentTarget,
  visibility: SubscriberVisibility,
): EventSourceLookup | undefined {
  const { trigger } = executor;
  switch (trigger.kind) {
    case "tailordb":
      return {
        resource: publishEventsConflict.tailorDBType(trigger.typeName).resource,
        trigger,
        declaredBy: (target) => declaresTailorDBType(target, trigger.typeName),
        pinned: (target) => pinsTailorDBType(target, trigger.typeName),
        keyIn: (owner) => {
          const namespace = tailorDBTypeNamespaceIn(owner, trigger.typeName);
          return namespace && eventSourceKey.tailorDBType(namespace, trigger.typeName);
        },
        narrowOwners: (candidates) =>
          narrowByVisibleNamespace({
            candidates,
            visible: visibility.tailorDBTypes,
            resourceKey: trigger.typeName,
            declaresIn: (target, namespace) =>
              declaresTailorDBTypeIn(target, namespace, trigger.typeName),
          }),
        externalHint: (target) =>
          describeExternal("TailorDB namespace", externalTailorDBNamespaces(target)),
      };
    case "resolverExecuted": {
      // The namespace the subscriber resolves the name through, in the same order
      // the trigger itself resolves it: a locally declared resolver wins, and only
      // then the namespaces the config sees. Reading it back off the owner by bare
      // name would pick whichever namespace comes first instead, and reading only
      // the visible map would call a local name ambiguous because an external
      // namespace happens to hold it too.
      const namespace =
        findResolverNamespace(subscriber.application, trigger.resolverName) ??
        visibility.resolvers.get(trigger.resolverName);
      return {
        resource: publishEventsConflict.resolver(trigger.resolverName).resource,
        trigger,
        declaredBy: (target) => declaresResolver(target, trigger.resolverName),
        pinned: (target) =>
          namespace !== undefined && pinsResolverIn(target, namespace, trigger.resolverName),
        keyIn: () => namespace && eventSourceKey.resolver(namespace, trigger.resolverName),
        narrowOwners: (candidates) =>
          narrowByVisibleNamespace({
            candidates,
            visible: visibility.resolvers,
            resourceKey: trigger.resolverName,
            declaresIn: (target, namespace) =>
              declaresResolverIn(target, namespace, trigger.resolverName),
          }),
        externalHint: (target) =>
          describeExternal("resolver namespace", externalResolverNamespaces(target)),
      };
    }
    case "idpUser": {
      const idpName = subscribedIdpName(subscriber.application, trigger);
      if (idpName === undefined) {
        return undefined;
      }
      return {
        resource: publishEventsConflict.idpService(idpName).resource,
        trigger,
        declaredBy: (target) => declaresIdp(target, idpName),
        pinned: (target) => pinsIdp(target, idpName),
        keyIn: () => eventSourceKey.idp(idpName),
        // IdP namespace names are unique across a run, so there is nothing to
        // tell apart once the subscriber can see the name.
        narrowOwners: (candidates) =>
          visibility.idps.has(idpName)
            ? candidates.filter((target) => declaresIdp(target, idpName))
            : [],
        // The trigger names the IdP, so the hint can be exact rather than a list.
        externalHint: (target) =>
          describeExternal(
            "IdP",
            externalIdpNames(target).filter((name) => name === idpName),
          ),
      };
    }
    case "workflowExecution":
    case "workflowJobExecution":
      return {
        // A job trigger subscribes to the jobs' events, not the workflow's own, so
        // naming the workflow would read as if its publishEvents were at stake.
        resource:
          trigger.kind === "workflowExecution"
            ? eventSourceLabel.workflow(trigger.workflowName)
            : eventSourceLabel.workflowJobs(trigger.workflowName),
        trigger,
        declaredBy: (target) => declaresWorkflow(target, trigger.workflowName),
        pinned: (target) =>
          trigger.kind === "workflowExecution"
            ? pinsWorkflow(target, trigger.workflowName)
            : pinsEveryJobOfWorkflow(target, trigger.workflowName),
        keyIn: () =>
          trigger.kind === "workflowExecution"
            ? eventSourceKey.workflow(trigger.workflowName)
            : eventSourceKey.workflowJobs(trigger.workflowName),
        narrowOwners: (candidates) =>
          candidates.filter((target) => declaresWorkflow(target, trigger.workflowName)),
        // A workflow has no `external` declaration to check.
        externalHint: () => undefined,
      };
    default:
      return undefined;
  }
}
/**
 * Reject a cross-config subscription whose dependency cannot be recorded.
 *
 * Records live on the subscribed resource, so there is always somewhere to put
 * one. What can be missing is the dependent's name: the record identifies it by
 * application id, and a subscriber that resolves without one cannot be recorded,
 * leaving the next deploy of the owner alone to turn publishing off unannounced.
 *
 * The check applies only to a run that writes: `--dry-run` leaves every id
 * uninjected, so demanding one there would reject configs a real deploy gives one.
 * @param subscriptions - Every event subscription resolved for the run
 * @param writes - Whether this run applies changes rather than only reporting them
 */
export function assertRecordableDependencies(
  subscriptions: ReadonlyArray<EventSubscription>,
  writes: boolean,
): void {
  for (const { subscriber, owner, executorName, resource, pinned } of subscriptions) {
    if (subscriber.config.path === owner.config.path) continue;
    if (pinned) continue;
    if (!writes) continue;
    const appId = subscriber.application.id;
    // An id that cannot form a label key fails the same way as a missing one, and
    // it has to fail here: the write happens partway through apply, once sibling
    // resources have already been mutated.
    if (appId !== undefined && dependedByAppLabelKey(appId) !== undefined) continue;
    const cause =
      appId === undefined
        ? `${subscriber.config.path} resolves without an "id" — a config that re-exports ` +
          `defineConfig() from another file never gets one`
        : `${subscriber.config.path} resolves to the id "${appId}", which is not the lowercase ` +
          `UUID deploy writes`;
    const fix =
      appId === undefined
        ? `Call defineConfig() inline in ${subscriber.config.path} so deploy can manage its "id".`
        : `Restore the generated value in ${subscriber.config.path}'s "id".`;
    throw new Error(
      `Executor "${executorName}" in ${subscriber.config.path} subscribes to ${resource} in ` +
        `${owner.config.path}, which would enable event publishing on it for this deploy only. ` +
        `${cause} — so deploy cannot record which config the dependency belongs to, and ` +
        `deploying ${owner.config.path} alone later would turn publishing back off without ` +
        `asking.\n\n${fix}`,
    );
  }
}
