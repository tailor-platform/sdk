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
      // Same pattern as resolver-bundler.ts:91-117
      return ml /* js */ `
        import _internalResolver from "${absoluteSourcePath}";
        import { t } from "@tailor-platform/sdk";

        const $tailor_resolver_body = async (context) => {
          if (_internalResolver.input) {
            const result = t.object(_internalResolver.input).parse({
              value: context.input,
              data: context.input,
              user: context.user,
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

          return _internalResolver.body(context);
        };

        export { $tailor_resolver_body as main };
      `;

    case "executor":
      // Same pattern as executor-bundler.ts:110-115
      return ml /* js */ `
        import _internalExecutor from "${absoluteSourcePath}";

        const __executor_function = _internalExecutor.operation.body;

        export { __executor_function as main };
      `;

    case "workflow-job": {
      // Same pattern as workflow-bundler.ts:238-245
      const exportName = detected.exportName!;
      return ml /* js */ `
        import { ${exportName} } from "${absoluteSourcePath}";

        const env = ${JSON.stringify(env)};

        export async function main(input) {
          const _user = ${tailorUserMap};
          return await ${exportName}.body(input, { env, user: _user });
        }
      `;
    }
  }
}
