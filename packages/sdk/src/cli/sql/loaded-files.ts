import * as mod from "node:module";
import { fileURLToPath } from "node:url";

let collecting: Set<string> | undefined;

/**
 * Record each project file the process imports from now on, for
 * {@link collectLoadedFiles}. Packages under `node_modules` are not recorded.
 */
export function observeLoadedFiles(): void {
  mod.registerHooks({
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
 * @returns What `load` resolved to, and the files it imported
 */
export async function collectLoadedFiles<T>(
  load: () => Promise<T>,
): Promise<{ value: T; files: string[] }> {
  const files = new Set<string>();
  collecting = files;
  try {
    return { value: await load(), files: [...files] };
  } finally {
    collecting = undefined;
  }
}
