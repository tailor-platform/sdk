import * as rolldown from "rolldown";
import { enableInlineSourcemap } from "@/cli/bundler/inline-sourcemap";

type CreateBundlerConfigParams = {
  input: string;
  outputPath: string;
  tsconfig: string | undefined;
  plugins: rolldown.Plugin[];
};

/**
 * Create a shared rolldown build configuration for bundlers.
 * @param params - Bundler config parameters
 * @returns A rolldown BuildOptions object
 */
export function createBundlerConfig(params: CreateBundlerConfigParams): rolldown.BuildOptions {
  return rolldown.defineConfig({
    input: params.input,
    output: {
      file: params.outputPath,
      format: "esm",
      sourcemap: enableInlineSourcemap ? "inline" : true,
      minify: enableInlineSourcemap
        ? {
            mangle: {
              keepNames: true,
            },
          }
        : true,
      inlineDynamicImports: true,
    },
    tsconfig: params.tsconfig,
    plugins: params.plugins,
    treeshake: {
      moduleSideEffects: false,
      annotations: true,
      unknownGlobalSideEffects: false,
    },
    logLevel: "silent",
  }) as rolldown.BuildOptions;
}
