import * as fs from "node:fs";
import * as mod from "node:module";
import { fileURLToPath } from "node:url";
import { findUpSync } from "find-up-simple";
import { createPathsMatcher, getTsconfig } from "get-tsconfig";
import * as path from "pathe";

let collecting: Set<string> | undefined;

const TS_EXTENSIONS = [".ts", ".mts"];
const KNOWN_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs", ".json"];
const JS_TO_TS = [
  [".js", ".ts"],
  [".mjs", ".mts"],
] as const;

function isLocalSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
}

function packageImportTargets(specifier: string, parentDir: string): string[] {
  const packageJson = findUpSync("package.json", { cwd: parentDir });
  if (!packageJson) return [];
  const imports = (JSON.parse(fs.readFileSync(packageJson, "utf8")) as { imports?: unknown })
    .imports;
  if (typeof imports !== "object" || imports === null) return [];
  const leaves = (target: unknown): string[] =>
    typeof target === "string"
      ? [target]
      : typeof target === "object" && target !== null
        ? Object.values(target).flatMap(leaves)
        : [];
  return Object.entries(imports).flatMap(([key, target]) => {
    const star = key.indexOf("*");
    const matched =
      star < 0
        ? key === specifier
          ? ""
          : undefined
        : specifier.startsWith(key.slice(0, star)) && specifier.endsWith(key.slice(star + 1))
          ? specifier.slice(star, specifier.length - (key.length - star - 1))
          : undefined;
    return matched === undefined
      ? []
      : leaves(target).map((leaf) =>
          path.resolve(
            path.dirname(packageJson),
            leaf.replaceAll("*", () => matched),
          ),
        );
  });
}

function tsconfigPathTargets(specifier: string, parentDir: string): string[] {
  const tsconfig = getTsconfig(parentDir);
  return (tsconfig && createPathsMatcher(tsconfig)?.(specifier)) || [];
}

function missingCandidates(specifier: string, parentURL: string): string[] {
  if (isLocalSpecifier(specifier)) {
    return candidatePaths(fileURLToPath(new URL(specifier, parentURL)));
  }
  const parentDir = path.dirname(fileURLToPath(parentURL));
  try {
    return specifier.startsWith("#")
      ? packageImportTargets(specifier, parentDir)
      : tsconfigPathTargets(specifier, parentDir).flatMap(candidatePaths);
  } catch {
    return [];
  }
}

function candidatePaths(target: string): string[] {
  if (!KNOWN_EXTENSIONS.some((extension) => target.endsWith(extension))) {
    return [
      ...TS_EXTENSIONS.map((extension) => target + extension),
      ...TS_EXTENSIONS.map((extension) => path.join(target, `index${extension}`)),
    ];
  }
  const substituted = JS_TO_TS.filter(([js]) => target.endsWith(js)).map(
    ([js, ts]) => target.slice(0, -js.length) + ts,
  );
  return [target, ...substituted];
}

/**
 * Record each project file the process imports from now on, for
 * {@link collectLoadedFiles}, and where a relative import that fails to
 * resolve would be created. Packages under `node_modules` are not recorded.
 */
export function observeLoadedFiles(): void {
  mod.registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (
          collecting &&
          context.parentURL?.startsWith("file:") &&
          !specifier.startsWith("node:")
        ) {
          for (const candidate of missingCandidates(specifier, context.parentURL)) {
            collecting.add(candidate);
          }
        }
        throw error;
      }
    },
    load(url, context, nextLoad) {
      if (collecting && url.startsWith("file:") && !url.includes("/node_modules/")) {
        const parsed = new URL(url);
        parsed.search = "";
        collecting.add(fileURLToPath(parsed));
      }
      return nextLoad(url, context);
    },
  });
}

/**
 * Run `load` and collect the project files it imported, when
 * {@link observeLoadedFiles} is active. Calls must not overlap.
 * @param load - Work that imports project modules
 * @returns How `load` settled, and the files it imported even when it failed
 */
export async function collectLoadedFiles<T>(
  load: () => Promise<T>,
): Promise<{ outcome: PromiseSettledResult<T>; files: string[] }> {
  const files = new Set<string>();
  collecting = files;
  try {
    const [outcome] = await Promise.allSettled([load()]);
    return { outcome, files: [...files] };
  } finally {
    collecting = undefined;
  }
}
