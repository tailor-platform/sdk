import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as path from "pathe";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Runs an ES module script in a child Node process that imports TypeScript
 * through the CLI's hook. Inside a Vitest worker vite-node intercepts
 * `import()`, so code that must see the hook and Node's real errors runs here.
 * The script can import SDK sources through the `#/` alias.
 * @param script - Module body that prints its outcome as JSON on its last stdout line
 * @param cwd - Working directory of the child process
 * @returns The parsed last stdout line
 */
export function runWithTsHook(script: string, cwd: string): unknown {
  const preamble = `
    import * as mod from "node:module";
    const { resolveSync, loadSync } = await import(${JSON.stringify(pathToFileURL(path.join(srcDir, "cli/ts-hook.mjs")).href)});
    mod.registerHooks({ resolve: resolveSync, load: loadSync });
    // Only the bundler resolves the "#/" alias; map it onto src/ for this native import.
    mod.registerHooks({
      resolve(specifier, context, next) {
        if (specifier.startsWith("#/")) {
          return next(new URL(specifier.slice(2) + ".ts", ${JSON.stringify(pathToFileURL(`${srcDir}/`).href)}).href, context);
        }
        return next(specifier, context);
      },
    });
  `;
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", preamble + script], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}");
}
