import { collectConfigIdpNames } from "./executor";
import type { ConfigServices } from "#/cli/services/application";
import type { DeployApplication } from "./deploy-application";

/** A config in the deploy run: the services it defines and the applications exposing them. */
type VisibleConfig = {
  application: Readonly<ConfigServices>;
  applications: ReadonlyArray<Pick<DeployApplication, "subgraphs">>;
};

function addPossiblyAmbiguousNamespace(
  namespaces: Map<string, string | undefined>,
  key: string,
  namespace: string,
): void {
  if (namespaces.has(key)) {
    if (namespaces.get(key) !== namespace) {
      namespaces.set(key, undefined);
    }
    return;
  }
  namespaces.set(key, namespace);
}

type VisibleResource = {
  visibilityKey: string;
  resourceKey: string;
};

type CollectVisibleResourcesParams<TResult> = {
  config: VisibleConfig;
  configs: ReadonlyArray<VisibleConfig>;
  visibleKeysOf: (config: VisibleConfig) => ReadonlySet<string>;
  resourcesOf: (services: Readonly<ConfigServices>) => Iterable<VisibleResource>;
  createResult: () => TResult;
  addResource: (result: TResult, resourceKey: string, visibilityKey: string) => void;
};

function collectVisibleResources<TResult>(params: CollectVisibleResourcesParams<TResult>): TResult {
  const { config, configs, visibleKeysOf, resourcesOf, createResult, addResource } = params;
  const visibleKeys = visibleKeysOf(config);
  const result = createResult();
  for (const candidate of configs) {
    for (const resource of resourcesOf(candidate.application)) {
      if (!visibleKeys.has(resource.visibilityKey)) {
        continue;
      }
      addResource(result, resource.resourceKey, resource.visibilityKey);
    }
  }
  return result;
}

function collectConfigTailorDBNamespaces(config: VisibleConfig): ReadonlySet<string> {
  return new Set([
    ...config.application.tailorDBServices.map((service) => service.namespace),
    ...config.application.externalTailorDBNamespaces,
  ]);
}

function* tailorDBTypeResources(services: Readonly<ConfigServices>): Iterable<VisibleResource> {
  for (const service of services.tailorDBServices) {
    for (const tableName of Object.keys(service.types)) {
      yield { visibilityKey: service.namespace, resourceKey: tableName };
    }
  }
}

export function collectVisibleTailorDBTypeNamespaces(
  config: VisibleConfig,
  configs: ReadonlyArray<VisibleConfig>,
): ReadonlyMap<string, string | undefined> {
  return collectVisibleResources({
    config,
    configs,
    visibleKeysOf: collectConfigTailorDBNamespaces,
    resourcesOf: tailorDBTypeResources,
    createResult: () => new Map<string, string | undefined>(),
    addResource: addPossiblyAmbiguousNamespace,
  });
}

function collectConfigResolverNamespaces(config: VisibleConfig): ReadonlySet<string> {
  return new Set(
    config.applications
      .flatMap((application) => application.subgraphs)
      .filter((subgraph) => subgraph.Type === "pipeline")
      .map((subgraph) => subgraph.Name),
  );
}

export function collectVisibleIdpNames(
  config: VisibleConfig,
  configs: ReadonlyArray<VisibleConfig>,
): ReadonlySet<string> {
  const names = new Set(collectConfigIdpNames(config));
  for (const candidate of configs) {
    for (const idp of candidate.application.idpServices) {
      names.add(idp.name);
    }
  }
  return names;
}

function* resolverResources(services: Readonly<ConfigServices>): Iterable<VisibleResource> {
  for (const service of services.resolverServices) {
    for (const resolver of Object.values(service.resolvers)) {
      yield { visibilityKey: service.namespace, resourceKey: resolver.name };
    }
  }
}

export function collectVisibleResolverNamespaces(
  config: VisibleConfig,
  configs: ReadonlyArray<VisibleConfig>,
): ReadonlyMap<string, string | undefined> {
  return collectVisibleResources({
    config,
    configs,
    visibleKeysOf: collectConfigResolverNamespaces,
    resourcesOf: resolverResources,
    createResult: () => new Map<string, string | undefined>(),
    addResource: addPossiblyAmbiguousNamespace,
  });
}
