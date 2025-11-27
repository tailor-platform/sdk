import * as fs from "node:fs";
import * as path from "node:path";
import { styleText } from "node:util";
import ml from "multiline-ts";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import {
  loadFilesWithIgnores,
  type FileLoadConfig,
} from "@/cli/application/file-loader";
import { getDistDir } from "@/configure/config";
import { loadResolver } from "./loader";

interface ResolverInfo {
  name: string;
  sourceFile: string;
}

/**
 * Bundle resolvers for the specified namespace
 *
 * This function:
 * 1. Uses a transform plugin to add validation wrapper during bundling
 * 2. Creates entry file
 * 3. Bundles in a single step with tree-shaking
 */
export async function bundleResolvers(
  namespace: string,
  config: FileLoadConfig,
): Promise<void> {
  const files = loadFilesWithIgnores(config);
  if (files.length === 0) {
    throw new Error(
      `No files found matching pattern: ${config.files?.join(", ")}`,
    );
  }

  console.log("");
  console.log(
    "Bundling",
    styleText("cyanBright", files.length.toString()),
    "files for",
    styleText("cyan", `"${namespace}"`),
  );

  // Load all resolvers to get their names
  const resolvers: ResolverInfo[] = [];
  for (const file of files) {
    const resolver = await loadResolver(file);
    if (!resolver) {
      console.log(
        styleText("dim", `  Skipping: ${file} (could not be loaded)`),
      );
      continue;
    }
    resolvers.push({
      name: resolver.name,
      sourceFile: file,
    });
  }

  const outputDir = path.resolve(getDistDir(), "resolvers");

  fs.mkdirSync(outputDir, { recursive: true });

  let tsconfig: string | undefined;
  try {
    tsconfig = await resolveTSConfig();
  } catch {
    tsconfig = undefined;
  }

  // Process each resolver
  await Promise.all(
    resolvers.map((resolver) =>
      bundleSingleResolver(resolver, outputDir, tsconfig),
    ),
  );

  console.log(
    styleText("green", "Bundled"),
    styleText("cyan", `"${namespace}"`),
  );
}

async function bundleSingleResolver(
  resolver: ResolverInfo,
  outputDir: string,
  tsconfig: string | undefined,
): Promise<void> {
  // Step 1: Create entry file that imports from the original source
  const entryPath = path.join(outputDir, `${resolver.name}.entry.js`);
  const absoluteSourcePath = path
    .resolve(resolver.sourceFile)
    .replace(/\\/g, "/");

  const entryContent = ml /* js */ `
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

    globalThis.main = $tailor_resolver_body;
  `;
  fs.writeFileSync(entryPath, entryContent);

  // Step 2: Bundle with tree-shaking
  const outputPath = path.join(outputDir, `${resolver.name}.js`);

  await rolldown.build(
    rolldown.defineConfig({
      input: entryPath,
      output: {
        file: outputPath,
        format: "esm",
        sourcemap: true,
        minify: true,
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
}
