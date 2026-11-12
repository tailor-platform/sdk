import { parseSync } from "oxc-parser";
import { RolldownMagicString } from "rolldown";
import type { EffectiveDateDefault } from "#/runtime/types";
import type * as rolldown from "rolldown";

// Match the exact `process.env.__TAILOR_PLATFORM_BUNDLE` member-expression: the
// leading lookbehind rejects a longer owner (`foo.process.env…`) or identifier,
// the trailing `\b` rejects a longer key (`…_BUNDLE_MODE`).
const GATE = /(?<![\w$.])process\.env\.__TAILOR_PLATFORM_BUNDLE\b/g;

// Fold the gate to `true` so the minifier DCEs the test-only workflow
// registry/serialize runner. Apply in every bundler that builds runnable
// functions; a missed path leaves the env read in place and fails loudly on the
// Platform's Web runtime (no `process`), which an e2e catches. rolldown exposes
// no `define`, so this is a transform-level replace rather than a define.
//
// The fold above only proves the branch dead after transform+parse; rolldown
// still resolves every top-level import a module contains before it can shake
// the dead branch out of the output. `createWorkflowJob`'s test-only invoker
// wrapper (test-env-key.ts, reachable from every bundler through the public
// `createWorkflowJob` export) needs `node:async_hooks` for correct scoping
// across concurrent local job invocations, but that specifier is never
// available on the Platform runtime and is unreachable there once the gate
// folds — so resolve it as external rather than failing the build over an
// import that never survives to the bundled output.
// Read at module top level, so unlike GATE they must not throw where `process` is absent.
const WITHOUT_DATE_GATE =
  /(?<![\w$.])globalThis\.process\?\.env\.__TAILOR_PLATFORM_BUNDLE_WITHOUT_DATE\b/g;
const WITHOUT_TEMPORAL_GATE =
  /(?<![\w$.])globalThis\.process\?\.env\.__TAILOR_PLATFORM_BUNDLE_WITHOUT_TEMPORAL\b/g;
// Read at call time by `dateRepresentationOf`; folded to the configured literal here.
const DATE_DEFAULT_GATE =
  /(?<![\w$.])globalThis\.process\?\.env\.__TAILOR_PLATFORM_BUNDLE_DATE_DEFAULT\b/g;

// Read at module top level by the bundled `getDB` of `@tailor-platform/sdk/plugin/kysely-type/db`.
const KYSELY_TEMPORAL_GATE =
  /(?<![\w$.])globalThis\.process\?\.env\.__TAILOR_PLATFORM_BUNDLE_KYSELY_TEMPORAL\b/g;

const DEPLOY_ONLY_CLI_ENTRY = "@tailor-platform/sdk/cli";
const DEPLOY_ONLY_CLI_STUB_PREFIX = "\0tailor-platform-sdk-cli-stub:";

function importedName(name: { type: string; name?: string; value?: unknown }): string {
  return name.type === "Identifier" ? String(name.name) : String(name.value);
}

function collectCliImports(code: string, id: string): Set<string> {
  const names = new Set<string>();
  const { program } = parseSync(id, code);
  for (const node of program.body) {
    if (node.type === "ImportDeclaration" && node.source.value === DEPLOY_ONLY_CLI_ENTRY) {
      for (const specifier of node.specifiers) {
        if (specifier.type === "ImportSpecifier") names.add(importedName(specifier.imported));
      }
    }
    if (node.type === "ExportNamedDeclaration" && node.source?.value === DEPLOY_ONLY_CLI_ENTRY) {
      for (const specifier of node.specifiers) names.add(importedName(specifier.local));
    }
  }
  return names;
}

/**
 * Date representations whose conversion code a bundle keeps.
 */
export type BundledDateRepresentations = {
  date: boolean;
  temporal: boolean;
};

/**
 * Create the platform bundle define plugin.
 * @param dateRepresentations - Date representations whose conversion code the bundle keeps
 * @param dateDefault - Representation applied to `t` date fields that omit `as`
 * @param kyselyTemporal - Whether `kyselyTypePlugin` is configured with `temporal: true`
 * @returns Rolldown plugin folding the platform bundle gates
 */
export function createPlatformBundleDefinePlugin(
  dateRepresentations: BundledDateRepresentations = { date: true, temporal: true },
  dateDefault: EffectiveDateDefault = "legacy",
  kyselyTemporal = false,
): rolldown.Plugin {
  const dateDefaultLiteral = dateDefault === "legacy" ? "undefined" : JSON.stringify(dateDefault);
  const kyselyTemporalLiteral = kyselyTemporal ? '"true"' : "undefined";
  const cliImportsByImporter = new Map<string, Set<string>>();
  return {
    name: "tailor-platform-bundle-define",
    transform(code, id) {
      if (code.includes(DEPLOY_ONLY_CLI_ENTRY)) {
        cliImportsByImporter.set(id, collectCliImports(code, id));
      }
      if (!code.includes("__TAILOR_PLATFORM_BUNDLE")) return null;
      const source = new RolldownMagicString(code)
        .replaceAll(GATE, "true")
        .replaceAll(WITHOUT_DATE_GATE, String(!dateRepresentations.date))
        .replaceAll(WITHOUT_TEMPORAL_GATE, String(!dateRepresentations.temporal))
        .replaceAll(DATE_DEFAULT_GATE, dateDefaultLiteral)
        .replaceAll(KYSELY_TEMPORAL_GATE, kyselyTemporalLiteral);
      return {
        code: source.toString(),
        map: source.generateMap({ hires: "boundary" }).toString(),
      };
    },
    resolveId(source, importer) {
      if (source === "node:async_hooks") return { id: source, external: true };
      if (source === DEPLOY_ONLY_CLI_ENTRY && importer) {
        return { id: DEPLOY_ONLY_CLI_STUB_PREFIX + importer, moduleSideEffects: false };
      }
      return null;
    },
    load(id) {
      if (!id.startsWith(DEPLOY_ONLY_CLI_STUB_PREFIX)) return null;
      const names = cliImportsByImporter.get(id.slice(DEPLOY_ONLY_CLI_STUB_PREFIX.length)) ?? [];
      return [...names].map((name) => `export const ${name} = undefined;`).join("\n");
    },
  };
}

export const platformBundleDefinePlugin: rolldown.Plugin = createPlatformBundleDefinePlugin();
