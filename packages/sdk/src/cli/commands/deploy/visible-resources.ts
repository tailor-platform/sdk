import { collectApplicationIdpNames } from "./executor";
import type { Application } from "#/cli/services/application";

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
  application: Readonly<Application>;
  applications: ReadonlyArray<Readonly<Application>>;
  visibleKeysOf: (application: Readonly<Application>) => ReadonlySet<string>;
  resourcesOf: (application: Readonly<Application>) => Iterable<VisibleResource>;
  createResult: () => TResult;
  addResource: (result: TResult, resourceKey: string, visibilityKey: string) => void;
};

function collectVisibleResources<TResult>(params: CollectVisibleResourcesParams<TResult>): TResult {
  const { application, applications, visibleKeysOf, resourcesOf, createResult, addResource } =
    params;
  const visibleKeys = visibleKeysOf(application);
  const result = createResult();
  for (const candidate of applications) {
    for (const resource of resourcesOf(candidate)) {
      if (!visibleKeys.has(resource.visibilityKey)) {
        continue;
      }
      addResource(result, resource.resourceKey, resource.visibilityKey);
    }
  }
  return result;
}

function collectApplicationTailorDBNamespaces(
  application: Readonly<Application>,
): ReadonlySet<string> {
  return new Set([
    ...application.tailorDBServices.map((service) => service.namespace),
    ...application.externalTailorDBNamespaces,
  ]);
}

function* tailorDBTypeResources(application: Readonly<Application>): Iterable<VisibleResource> {
  for (const service of application.tailorDBServices) {
    for (const tableName of Object.keys(service.types)) {
      yield { visibilityKey: service.namespace, resourceKey: tableName };
    }
  }
}

export function collectVisibleTailorDBTypeNamespaces(
  application: Readonly<Application>,
  applications: ReadonlyArray<Readonly<Application>>,
): ReadonlyMap<string, string | undefined> {
  return collectVisibleResources({
    application,
    applications,
    visibleKeysOf: collectApplicationTailorDBNamespaces,
    resourcesOf: tailorDBTypeResources,
    createResult: () => new Map<string, string | undefined>(),
    addResource: addPossiblyAmbiguousNamespace,
  });
}

function collectApplicationResolverNamespaces(
  application: Readonly<Application>,
): ReadonlySet<string> {
  return new Set(
    application.subgraphs
      .filter((subgraph) => subgraph.Type === "pipeline")
      .map((subgraph) => subgraph.Name),
  );
}

function* idpNameResources(application: Readonly<Application>): Iterable<VisibleResource> {
  for (const name of collectApplicationIdpNames(application)) {
    yield { visibilityKey: name, resourceKey: name };
  }
}

export function collectVisibleIdpNames(
  application: Readonly<Application>,
  applications: ReadonlyArray<Readonly<Application>>,
): ReadonlySet<string> {
  return collectVisibleResources({
    application,
    applications,
    visibleKeysOf: collectApplicationIdpNames,
    resourcesOf: idpNameResources,
    createResult: () => new Set<string>(),
    addResource: (names, name) => {
      names.add(name);
    },
  });
}

function* resolverResources(application: Readonly<Application>): Iterable<VisibleResource> {
  for (const service of application.resolverServices) {
    for (const resolver of Object.values(service.resolvers)) {
      yield { visibilityKey: service.namespace, resourceKey: resolver.name };
    }
  }
}

export function collectVisibleResolverNamespaces(
  application: Readonly<Application>,
  applications: ReadonlyArray<Readonly<Application>>,
): ReadonlyMap<string, string | undefined> {
  return collectVisibleResources({
    application,
    applications,
    visibleKeysOf: collectApplicationResolverNamespaces,
    resourcesOf: resolverResources,
    createResult: () => new Map<string, string | undefined>(),
    addResource: addPossiblyAmbiguousNamespace,
  });
}
