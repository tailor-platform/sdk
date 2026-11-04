import * as mod from "node:module";
import { fileURLToPath } from "node:url";
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

function candidatePaths(specifier: string, parentURL: string): string[] {
  const target = fileURLToPath(new URL(specifier, parentURL));
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
        if (collecting && context.parentURL?.startsWith("file:") && isLocalSpecifier(specifier)) {
          for (const candidate of candidatePaths(specifier, context.parentURL)) {
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
