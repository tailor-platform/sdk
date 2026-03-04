/**
 * Bundler for function test-run command
 *
 * Bundles a single function file for execution via the TestExecScript API.
 * Generates an entry file based on the detected function type and bundles
 * with rolldown, following the same patterns as the existing bundlers.
 */

import * as fs from "node:fs";
import ml from "multiline-ts";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { getDistDir } from "@/cli/shared/dist-dir";
import { resolveInlineSourcemap } from "@/cli/shared/inline-sourcemap";
import { tailorUserMap } from "@/parser/service/tailordb";
import type { DetectedFunction } from "./detect";

// Inline unauthenticated user fallback (matches unauthenticatedTailorUser from @/configure/types/user)
const unauthenticatedUserExpr = JSON.stringify({
  id: "00000000-0000-0000-0000-000000000000",
  type: "",
  workspaceId: "00000000-0000-0000-0000-000000000000",
  attributes: null,
  attributeList: [],
});

interface BundleForTestRunOptions {
  /** Detected function info */
  detected: DetectedFunction;
  /** Absolute path to the source file */
  sourceFile: string;
  /** Environment variables (injected into workflow job bundles) */
  env?: Record<string, string | number | boolean>;
  /** Inline sourcemap config value from defineConfig */
  inlineSourcemap?: boolean;
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
  const { detected, sourceFile, env = {} } = options;
  const inlineSourcemap = resolveInlineSourcemap(options.inlineSourcemap);

  const outputDir = path.resolve(getDistDir(), "test-run");
  fs.mkdirSync(outputDir, { recursive: true });

  const baseName = `test-run--${detected.name}`;
  const scriptName = `${baseName}.js`;
  const entryPath = path.join(outputDir, `${baseName}.entry.js`);
  const outputPath = path.join(outputDir, scriptName);

  const entryContent = generateEntry(detected, sourceFile, env);
  fs.writeFileSync(entryPath, entryContent);

  let tsconfig: string | undefined;
  try {
    tsconfig = await resolveTSConfig();
  } catch {
    tsconfig = undefined;
  }

  await rolldown.build(
    rolldown.defineConfig({
      input: entryPath,
      output: {
        file: outputPath,
        format: "esm",
        sourcemap: inlineSourcemap ? "inline" : true,
        minify: inlineSourcemap
          ? {
              mangle: {
                keepNames: true,
              },
            }
          : true,
        inlineDynamicImports: true,
      },
      tsconfig,
      treeshake: {
        moduleSideEffects: false,
        annotations: true,
        unknownGlobalSideEffects: false,
      },
      logLevel: "silent",
    }) as rolldown.BuildOptions,
  );

  const bundledCode = fs.readFileSync(outputPath, "utf-8");

  return { bundledCode, scriptName };
}

/**
 * Generate entry file content based on the detected function type.
 * @param detected - Detected function info
 * @param sourceFile - Absolute path to the source file
 * @param env - Environment variables for workflow job bundles
 * @returns Entry file content string
 */
function generateEntry(
  detected: DetectedFunction,
  sourceFile: string,
  env: Record<string, string | number | boolean>,
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

    case "resolver":
      // Same pattern as services/resolver/bundler.ts:125-152
      // In production, the operationHook injects user/env into context.
      // For test-run, we inject them here since there's no operationHook.
      return ml /* js */ `
        import _internalResolver from "${absoluteSourcePath}";
        import { t } from "@tailor-platform/sdk";

        const _env = ${JSON.stringify(env)};
        const _user = typeof user !== "undefined"
          ? ${tailorUserMap}
          : (console.warn("[test-run] user global not available, using unauthenticated user fallback"), ${unauthenticatedUserExpr});

        const $tailor_resolver_body = async (context) => {
          const enrichedContext = { ...context, env: _env, user: _user };

          if (_internalResolver.input) {
            const result = t.object(_internalResolver.input).parse({
              value: enrichedContext.input,
              data: enrichedContext.input,
              user: enrichedContext.user,
            });

            if (result.issues) {
              const errorMessages = result.issues
                .map(issue => {
                  const path = issue.path ? issue.path.join('.') : '';
                  return path ? \`  \${path}: \${issue.message}\` : issue.message;
                })
                .join('\\n');
              throw new Error(\`Failed to input validation:\\n\${errorMessages}\`);
            }
          }

          return _internalResolver.body(enrichedContext);
        };

        export { $tailor_resolver_body as main };
      `;

    case "executor":
      // Same pattern as services/executor/bundler.ts:144-150
      // In production, buildExecutorArgsExpr injects actor/env into args.
      // For test-run, we inject env here.
      return ml /* js */ `
        import _internalExecutor from "${absoluteSourcePath}";

        const _env = ${JSON.stringify(env)};

        const __executor_function = async (args) => {
          return _internalExecutor.operation.body({ ...args, env: _env });
        };

        export { __executor_function as main };
      `;

    case "workflow-job": {
      // Same pattern as services/workflow/bundler.ts:286-294
      // Note: user context is not available in TestExecScript for workflow jobs.
      // The production workflow bundler's user mapping is being fixed in fix/workflow-user.
      const exportName = detected.exportName!;
      return ml /* js */ `
        import { ${exportName} } from "${absoluteSourcePath}";

        const env = ${JSON.stringify(env)};

        export async function main(input) {
          return await ${exportName}.body(input, { env });
        }
      `;
    }
  }
}
