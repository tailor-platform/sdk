import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "pathe";
import { getDistDir } from "#/cli/shared/dist-dir";
import { serializeSqlDefinitions, type SqlDefinitions } from "#/utils/sql/analyze";
import type { TailorDBService } from "#/cli/services/tailordb/service";

/** What bundling a `.sql` import needs. */
export interface SqlBundleContext {
  definitions: SqlDefinitions;
  /** Files a bundle importing a `.sql` file depends on beyond the file itself. */
  dependencies: readonly string[];
}

/** Provides the context on the first `.sql` import, so functions without one never load it. */
export type SqlContextLoader = () => Promise<SqlBundleContext>;

/**
 * Collect the definitions `.sql` files are checked against from loaded TailorDB services.
 * @param services - TailorDB services whose types are loaded
 * @param temporal - Whether date/datetime/time values come back as Temporal objects
 * @returns The definitions
 */
export function sqlDefinitionsOf(
  services: readonly Pick<TailorDBService, "namespace" | "types">[],
  temporal: boolean,
): SqlDefinitions {
  return {
    namespaces: new Map(
      services.map((service) => [service.namespace, Object.values(service.types)]),
    ),
    temporal,
  };
}

/**
 * Create the context for bundling `.sql` imports. The serialized definitions
 * are written to `fingerprintFile`, which each such bundle depends on, so a
 * cached bundle is rebuilt when a definition its statement reads changes.
 * @param definitions - TailorDB tables by namespace, and how dates are returned
 * @param fingerprintFile - File to keep the serialized definitions in
 * @returns A loader resolving to the context
 */
export function createSqlContext(
  definitions: SqlDefinitions,
  fingerprintFile: string,
): SqlContextLoader {
  const serialized = serializeSqlDefinitions(definitions);
  const current = fs.existsSync(fingerprintFile)
    ? fs.readFileSync(fingerprintFile, "utf8")
    : undefined;
  if (current !== serialized) {
    fs.mkdirSync(path.dirname(fingerprintFile), { recursive: true });
    fs.writeFileSync(fingerprintFile, serialized);
  }
  const context: SqlBundleContext = { definitions, dependencies: [fingerprintFile] };
  return () => Promise.resolve(context);
}

/**
 * The file {@link createSqlContext} keeps a config's serialized definitions in.
 * @param configPath - Path of the config the definitions come from
 * @returns Absolute path under the build output directory
 */
export function sqlFingerprintFile(configPath: string): string {
  const key = createHash("sha256").update(path.resolve(configPath)).digest("hex").slice(0, 16);
  return path.resolve(getDistDir(), "sql", `${key}.json`);
}
