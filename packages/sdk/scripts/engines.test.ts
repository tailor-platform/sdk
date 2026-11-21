import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { minVersion, subset, validRange } from "semver";
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

const runtimeEdges = (manifest: Manifest) => [
  ...Object.keys(manifest.dependencies ?? {}).map((name) => ({ name, optional: false })),
  ...Object.keys(manifest.optionalDependencies ?? {}).map((name) => ({ name, optional: true })),
  ...Object.keys(manifest.peerDependencies ?? {})
    .filter((name) => !manifest.peerDependenciesMeta?.[name]?.optional)
    .map((name) => ({ name, optional: false })),
];

const unsupportedDependencies = (packageDir: string, range: string): string[] => {
  const unsupported: string[] = [];
  const visited = new Set<string>();
  const queue = [
    { dir: realpathSync(packageDir), manifest: readManifest(packageDir), chain: [] as string[] },
  ];
  for (let item = queue.shift(); item; item = queue.shift()) {
    const chain = [...item.chain, item.manifest.name];
    for (const edge of runtimeEdges(item.manifest)) {
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

const packagesWithNodeEngines = readdirSync(packagesDir)
  .map((name) => path.join(packagesDir, name))
  .filter((dir) => existsSync(path.join(dir, "package.json")))
  .flatMap((dir) => {
    const manifest = readManifest(dir);
    const range = nodeRange(manifest);
    return manifest.private || range === undefined ? [] : [{ name: manifest.name, dir, range }];
  });

test.each(packagesWithNodeEngines)(
  "$name runtime dependencies support every Node version in its engines.node",
  ({ dir, range }) => {
    expect(
      unsupportedDependencies(dir, range),
      "Narrow engines.node, or keep each listed dependency at a version that supports the current range",
    ).toEqual([]);
  },
);

const workflowsDir = path.resolve(packagesDir, "../.github/workflows");

const engineMajors = [
  ...new Set(
    packagesWithNodeEngines.flatMap(({ name, range }) =>
      range.split("||").map((part) => {
        const lowest = minVersion(part);
        if (lowest === null) throw new Error(`${name} engines.node has an empty range: ${part}`);
        return lowest.major;
      }),
    ),
  ),
].toSorted((a, b) => a - b);

test("CI tests every Node major that engines.node names", () => {
  const testWorkflow = readFileSync(path.join(workflowsDir, "test.yml"), "utf8");
  const matrixList = /^\s+node: \[([\d, ]*)\]$/m.exec(testWorkflow)?.[1];
  if (matrixList === undefined) {
    throw new Error("test.yml has no `node: [<majors>]` line; update this test to read it");
  }
  const matrixMajors = matrixList.split(",").map((major) => Number(major.trim()));
  expect(matrixMajors, "Add the major to the test job's `node` matrix in test.yml").toEqual(
    expect.arrayContaining(engineMajors),
  );

  const smokeWorkflow = readFileSync(path.join(workflowsDir, "pkg-pr-new.yml"), "utf8");
  const smokeMajors = Array.from(
    smokeWorkflow.matchAll(/- runtime: node\n\s+pm: \S+\n\s+node: (\d+)/g),
    (match) => Number(match[1]),
  );
  expect(
    smokeMajors,
    "Every `runtime: node` row in pkg-pr-new.yml must list `pm` and then `node`",
  ).toHaveLength(smokeWorkflow.match(/- runtime: node$/gm)?.length ?? 0);
  expect(
    smokeMajors,
    "Give the major an init-smoke row with `runtime: node` in pkg-pr-new.yml",
  ).toEqual(expect.arrayContaining(engineMajors));
});
