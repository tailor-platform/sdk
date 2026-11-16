import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { subset, validRange } from "semver";
import { expect, test } from "vitest";

type Manifest = {
  name: string;
  version: string;
  private?: boolean;
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

const packagesDir = path.resolve(import.meta.dirname, "../..");

const readManifest = (dir: string): Manifest =>
  JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as Manifest;

const nodeRange = (manifest: Manifest): string | undefined => {
  const range = manifest.engines?.node;
  if (range !== undefined && validRange(range) === null) {
    throw new Error(`${manifest.name}@${manifest.version} has an invalid engines.node: ${range}`);
  }
  return range;
};

const resolveInstalled = (fromDir: string, name: string): string | undefined => {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return realpathSync(candidate);
    if (path.dirname(dir) === dir) return undefined;
  }
};

const runtimeEdges = (manifest: Manifest, includePeers: boolean) => [
  ...Object.keys(manifest.dependencies ?? {}).map((name) => ({ name, optional: false })),
  ...Object.keys(manifest.optionalDependencies ?? {}).map((name) => ({ name, optional: true })),
  ...(includePeers
    ? Object.keys(manifest.peerDependencies ?? {})
        .filter((name) => !manifest.peerDependenciesMeta?.[name]?.optional)
        .map((name) => ({ name, optional: false }))
    : []),
];

const unsupportedDependencies = (packageDir: string, range: string): string[] => {
  const unsupported: string[] = [];
  const visited = new Set<string>();
  const queue = [
    { dir: realpathSync(packageDir), manifest: readManifest(packageDir), chain: [] as string[] },
  ];
  for (let item = queue.shift(); item; item = queue.shift()) {
    const chain = [...item.chain, item.manifest.name];
    for (const edge of runtimeEdges(item.manifest, item.chain.length === 0)) {
      const dir = resolveInstalled(item.dir, edge.name);
      if (dir === undefined) {
        if (edge.optional) continue;
        throw new Error(`${edge.name} (required by ${chain.join(" > ")}) is not installed`);
      }
      if (visited.has(dir)) continue;
      visited.add(dir);
      const manifest = readManifest(dir);
      const dependencyRange = nodeRange(manifest);
      if (dependencyRange !== undefined && !subset(range, dependencyRange)) {
        unsupported.push(
          `${manifest.name}@${manifest.version} requires node ${dependencyRange} (via ${chain.join(" > ")})`,
        );
      }
      queue.push({ dir, manifest, chain });
    }
  }
  return unsupported;
};

const publishedPackages = readdirSync(packagesDir)
  .map((name) => path.join(packagesDir, name))
  .filter((dir) => existsSync(path.join(dir, "package.json")))
  .map((dir) => ({ dir, manifest: readManifest(dir) }))
  .filter(({ manifest }) => !manifest.private && manifest.engines?.node !== undefined)
  .map(({ dir, manifest }) => ({ name: manifest.name, dir, range: nodeRange(manifest)! }));

test.each(publishedPackages)(
  "$name runtime dependencies support every Node version in its engines.node",
  ({ dir, range }) => {
    expect(
      unsupportedDependencies(dir, range),
      "Narrow engines.node, or keep each listed dependency at a version that supports the current range",
    ).toEqual([]);
  },
);
