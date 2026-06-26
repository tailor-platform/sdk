// Verify zod stays isolated to the CLI entry point.
//
// zinfer exists so that user-facing entry points never depend on zod:
// neither at the type level (a user's tsc must not load zod's type
// definitions when importing the SDK) nor at the runtime level (zod code
// must not end up in bundled user functions). This check walks the
// relative-import closure of every package.json#exports entry in dist/ and
// fails if any non-allowlisted entry can reach a zod import — in its
// rolled-up .d.mts graph (type level) or its .mjs graph (runtime level).
//
// Run after `pnpm build` (operates on dist/).
import { existsSync, readFileSync } from "node:fs";
import { dirname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractImportSpecifiers } from "./lib/scan-imports.js";

const here = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(here, "..");

// Entries allowed to reference zod. The CLI bundles the parser layer, whose
// Zod schemas are the source of truth zinfer generates types from.
const ZOD_ALLOWED_ENTRIES = new Set(["./cli"]);

interface ExportTarget {
  types?: string;
  import?: string;
  default?: string;
}

const pkg = JSON.parse(readFileSync(resolve(sdkRoot, "package.json"), "utf8")) as {
  exports: Record<string, string | ExportTarget | null>;
};

interface ZodReference {
  file: string;
  specifier: string;
}

// A built dist chunk a relative specifier should always resolve to. If one of
// these fails to resolve, the bundler's chunk-reference style likely changed
// and the walk would terminate early — so we fail loudly rather than pass
// vacuously (the whole point of this guard is to catch leaks).
function looksLikeDistChunk(specifier: string): boolean {
  return /\.(mjs|cjs|js)$/.test(specifier) || /\.d\.(m|c)?ts$/.test(specifier);
}

function findZodReferences(entryFile: string): ZodReference[] {
  const seen = new Set<string>();
  const stack = [entryFile];
  const references: ZodReference[] = [];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const specifier of extractImportSpecifiers(source)) {
      if (specifier === "zod" || specifier.startsWith("zod/")) {
        references.push({ file, specifier });
        continue;
      }
      if (!specifier.startsWith(".")) {
        continue; // external package or node: builtin
      }
      const target = normalize(resolve(dirname(file), specifier));
      // .d.mts chunks reference sibling declaration chunks with a .mjs
      // specifier, which TypeScript resolves to the .d.mts file.
      const resolved =
        existsSync(target) || !file.endsWith(".d.mts")
          ? target
          : target.replace(/\.mjs$/, ".d.mts");
      if (!existsSync(resolved)) {
        if (looksLikeDistChunk(specifier)) {
          throw new Error(
            `Unresolved dist chunk reference ${JSON.stringify(specifier)} from ${file}. ` +
              "The bundler chunk-reference style may have changed; update check-zod-isolation " +
              "so the import closure is walked completely (a vacuous pass would hide zod leaks).",
          );
        }
        continue; // non-chunk relative path (e.g. an asset) that legitimately has no further imports
      }
      stack.push(resolved);
    }
  }
  return references;
}

interface Violation {
  entry: string;
  level: "types" | "runtime";
  references: ZodReference[];
}

const violations: Violation[] = [];

for (const [entry, target] of Object.entries(pkg.exports)) {
  if (ZOD_ALLOWED_ENTRIES.has(entry)) {
    continue;
  }
  if (typeof target !== "object" || target === null) {
    // A string-form export target would otherwise be skipped silently, leaving
    // that entry point unchecked. Require the object form so types + runtime are
    // both verified.
    throw new Error(
      `exports[${JSON.stringify(entry)}] is not in object form ({ types, import/default }); ` +
        "check-zod-isolation cannot verify it. Convert it to the object form.",
    );
  }
  const checks: { level: "types" | "runtime"; file: string | undefined }[] = [
    { level: "types", file: target.types },
    { level: "runtime", file: target.default ?? target.import },
  ];
  for (const { level, file } of checks) {
    if (!file) {
      throw new Error(`exports[${JSON.stringify(entry)}] has no ${level} target`);
    }
    const entryFile = resolve(sdkRoot, file);
    if (!existsSync(entryFile)) {
      throw new Error(
        `exports[${JSON.stringify(entry)}] target missing: ${file} (run pnpm build first)`,
      );
    }
    const references = findZodReferences(entryFile);
    if (references.length > 0) {
      violations.push({ entry, level, references });
    }
  }
}

if (violations.length === 0) {
  console.log("check-zod-isolation: all non-CLI entry points are zod-free (types + runtime).");
  process.exit(0);
}

console.error(
  "check-zod-isolation: zod is reachable from user-facing entry points.\n" +
    "User projects must never load zod through the SDK — schema-derived types belong in\n" +
    "zinfer-generated files (src/types/*.generated.ts), and runtime zod usage belongs to the CLI.\n",
);
for (const violation of violations) {
  console.error(`  exports[${JSON.stringify(violation.entry)}] (${violation.level}):`);
  for (const reference of violation.references) {
    console.error(`    ${reference.file} imports ${JSON.stringify(reference.specifier)}`);
  }
}
process.exit(1);
