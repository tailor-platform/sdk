/**
 * Bundler for function test-run command
 *
 * Bundles a single function file for execution via the TestExecScript API.
 * Generates an entry file based on the detected function type and bundles
 * with rolldown, following the same patterns as the existing bundlers.
 */

import * as fs from "node:fs";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import {
  createLogLevelTreeshakeOptions,
  resolveBundleLogLevel,
} from "@/cli/shared/bundle-log-level";
import { getDistDir } from "@/cli/shared/dist-dir";
import { composeFunctionTreeshakeOptions } from "@/cli/shared/function-treeshake";
import { resolveInlineSourcemap } from "@/cli/shared/inline-sourcemap";
import { platformBundleDefinePlugin } from "@/cli/shared/platform-bundle-plugin";
import { INVOKER_EXPR } from "@/cli/shared/runtime-exprs";
import { assertDefined } from "@/utils/assert";
import ml from "@/utils/multiline";
import type { DetectedFunction } from "./detect";
import type { LogLevelInput } from "@/configure/config/types";

/** Machine user info resolved from config and API for bundle-time principal context. */
export interface ResolvedMachineUser {
  /** Machine user name */
  name: string;
  /** Machine user ID (UUID from API, or nil UUID if unavailable) */
  id: string;
  /** Attributes from config (null if not found in config, e.g. external auth) */
  attributes: Record<string, unknown> | null;
  /** Attribute list from config */
  attributeList: unknown[];
}

interface BundleForTestRunOptions {
  /** Detected function info */
  detected: DetectedFunction;
  /** Absolute path to the source file */
  sourceFile: string;
  /** Environment variables (injected into workflow job bundles) */
  env?: Record<string, string | number | boolean>;
  /** Inline sourcemap config value from defineConfig */
  inlineSourcemap?: boolean;
  /** Log level config value from defineConfig */
  logLevel?: LogLevelInput;
  /** Machine user info for injecting principal context into the bundle */
  machineUser: ResolvedMachineUser;
  /** Workspace ID for user context */
  workspaceId: string;
}

interface BundleForTestRunResult {
  /** The bundled JavaScript code */
  bundledCode: string;
  /** Name used for the script */
  scriptName: string;
}

/**
 * Bundle a function file for test-run execution via TestExecScript API.
 * @param options - Bundle options
 * @returns Bundled code and script name
 */
export async function bundleForTestRun(
  options: BundleForTestRunOptions,
): Promise<BundleForTestRunResult> {
  const { detected, sourceFile, env = {}, machineUser, workspaceId } = options;
  const inlineSourcemap = resolveInlineSourcemap(options.inlineSourcemap);
  const bundleLogLevel = resolveBundleLogLevel(options.logLevel);

  const outputDir = path.resolve(getDistDir(), "test-run");
  fs.mkdirSync(outputDir, { recursive: true });

  const baseName = `test-run--${detected.name}`;
  const scriptName = `${baseName}.js`;
  const entryPath = path.join(outputDir, `${baseName}.entry.js`);

  const entryContent = generateEntry(detected, sourceFile, env, machineUser, workspaceId);
  fs.writeFileSync(entryPath, entryContent);

  let tsconfig: string | undefined;
  try {
    tsconfig = await resolveTSConfig();
  } catch {
    tsconfig = undefined;
  }

  const buildResult = await rolldown.build({
    plugins: [platformBundleDefinePlugin],
    input: entryPath,
    write: false,
    output: {
      format: "esm",
      sourcemap: inlineSourcemap ? "inline" : true,
      minify: inlineSourcemap
        ? {
            mangle: {
              keepNames: true,
            },
          }
        : true,
      codeSplitting: false,
      // Emit sourcemap `sources` relative to cwd so stack traces resolve
      // back to paths a user can open (e.g. `resolvers/add.ts`), not the
      // rolldown-default virtual output dir which produces spurious `..`
      // segments.
      dir: process.cwd(),
    },
    tsconfig,
    treeshake: composeFunctionTreeshakeOptions([createLogLevelTreeshakeOptions(bundleLogLevel)]),
    logLevel: "silent",
  } as rolldown.BuildOptions);

  const bundledCode = buildResult.output[0].code;

  return { bundledCode, scriptName };
}

/**
 * Generate entry file content based on the detected function type.
 * @param detected - Detected function info
 * @param sourceFile - Absolute path to the source file
 * @param env - Environment variables for workflow job bundles
 * @param machineUser - Resolved machine user info
 * @param workspaceId - Workspace ID
 * @returns Entry file content string
 */
function generateEntry(
  detected: DetectedFunction,
  sourceFile: string,
  env: Record<string, string | number | boolean>,
  machineUser: ResolvedMachineUser,
  workspaceId: string,
): string {
  const absoluteSourcePath = path.resolve(sourceFile);

  switch (detected.type) {
    case "plain":
      if (detected.namedMain) {
        return ml /* js */ `
          export { main } from "${absoluteSourcePath}";
        `;
      }
      return ml /* js */ `
        import _fn from "${absoluteSourcePath}";
        export { _fn as main };
      `;

    case "resolver": {
      // Mirrors the production resolver bundler (services/resolver/bundler.ts).
      // In production, the operationHook injects caller/env into context.
      // For test-run, we embed machine user info since there's no operationHook.
      const principalExpr = buildMachinePrincipalExpr(machineUser, workspaceId);
      return ml /* js */ `
        import _internalResolver from "${absoluteSourcePath}";
        import { t } from "@tailor-platform/sdk";

        const _env = ${JSON.stringify(env)};
        const _caller = ${principalExpr};

        const $tailor_resolver_body = async (context) => {
          const _invoker = ${INVOKER_EXPR} ?? _caller;
          if (_internalResolver.input) {
            const result = t.object(_internalResolver.input).parse({
              value: context,
              data: context,
              invoker: _invoker,
            });

            if (result.issues) {
              throw new TailorErrors(result.issues.map(issue => ({
                message: issue.message,
                path: issue.path ?? [],
              })));
            }
          }

          const enrichedContext = { input: context, env: _env, caller: _caller, invoker: _invoker };
          return _internalResolver.body(enrichedContext);
        };

        export { $tailor_resolver_body as main };
      `;
    }

    case "executor": {
      // Mirrors the production executor bundler (services/executor/bundler.ts).
      // In production, buildExecutorArgsExpr injects actor/env into args.
      // For test-run, we embed machine user as actor.
      const principalExpr = buildMachinePrincipalExpr(machineUser, workspaceId);
      return ml /* js */ `
        import _internalExecutor from "${absoluteSourcePath}";

        const _env = ${JSON.stringify(env)};
        const _actor = ${principalExpr};

        const __executor_function = async (args) => {
          const _invoker = ${INVOKER_EXPR} ?? _actor;
          return _internalExecutor.operation.body({ ...args, env: _env, actor: _actor, invoker: _invoker });
        };

        export { __executor_function as main };
      `;
    }

    case "workflow-job": {
      // Mirrors the production workflow bundler (services/workflow/bundler.ts).
      // Note: user context is not available in TestExecScript for workflow jobs.
      // The production workflow bundler's user mapping is being fixed in fix/workflow-user.
      const exportName = assertDefined(detected.exportName, "workflow job export name missing");
      const principalExpr = buildMachinePrincipalExpr(machineUser, workspaceId);
      return ml /* js */ `
        import { ${exportName} } from "${absoluteSourcePath}";

        const env = ${JSON.stringify(env)};
        const fallbackInvoker = ${principalExpr};

        export async function main(input) {
          const invoker = ${INVOKER_EXPR} ?? fallbackInvoker;
          return await ${exportName}.body(input, { env, invoker });
        }
      `;
    }
  }
}

/**
 * Build a JSON expression for a machine user TailorPrincipal object.
 * @param machineUser - Resolved machine user info
 * @param workspaceId - Workspace ID
 * @returns JSON string for the user expression
 */
function buildMachinePrincipalExpr(machineUser: ResolvedMachineUser, workspaceId: string): string {
  return JSON.stringify({
    id: machineUser.id,
    type: "machine_user",
    workspaceId,
    attributes: machineUser.attributes ?? {},
    attributeList: machineUser.attributeList,
  });
}
