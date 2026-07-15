import * as fs from "node:fs";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { createResolverService } from "./service";

describe("createResolverService.loadResolvers", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  function writeResolver(name: string, source: string): string {
    if (!tmpDir) {
      // Place fixtures inside the SDK package so dynamic `import()` can resolve
      // `@tailor-platform/sdk` via the workspace node_modules tree. os.tmpdir()
      // would put them outside the workspace and break module resolution for
      // tests that exercise the actual import path.
      tmpDir = fs.realpathSync(
        fs.mkdtempSync(path.join(import.meta.dirname, ".resolver-service-")),
      );
    }
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, source);
    return file;
  }

  function resolverSource(name: string): string {
    return `
import { createResolver, t } from "@tailor-platform/sdk";
export default createResolver({
  name: "${name}",
  operation: "query",
  body: () => 1,
  output: t.int(),
});
`;
  }

  test("loads resolvers with distinct names", async () => {
    const fileA = writeResolver("a.ts", resolverSource("resolver-a"));
    const fileB = writeResolver("b.ts", resolverSource("resolver-b"));

    const service = createResolverService("ns", { files: [fileA, fileB] });
    await service.loadResolvers();

    expect(
      Object.values(service.resolvers)
        .map((r) => r.name)
        .toSorted(),
    ).toEqual(["resolver-a", "resolver-b"]);
  });

  test("rejects two files in the same namespace declaring the same resolver name", async () => {
    const fileA = writeResolver("a.ts", resolverSource("duplicate"));
    const fileB = writeResolver("b.ts", resolverSource("duplicate"));

    const service = createResolverService("ns", { files: [fileA, fileB] });

    await expect(service.loadResolvers()).rejects.toThrow(
      /Duplicate resolver name "duplicate" found in namespace "ns"/,
    );
  });
});
