import * as fs from "node:fs";
import * as path from "node:path";
import ml from "multiline-ts";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import {
  loadFilesWithIgnores,
  type FileLoadConfig,
} from "@/cli/application/file-loader";
import { getDistDir } from "@/configure/config";
import { ResolverLoader } from "./loader";

interface ResolverInfo {
  name: string;
  sourceFile: string;
}

/**
 * Simplified resolver bundler that:
 * 1. Uses a transform plugin to add validation wrapper during bundling
 * 2. Creates entry file
 * 3. Bundles in a single step with tree-shaking
 */
export class ResolverBundler {
  private loader = new ResolverLoader();

  constructor(
    private namespace: string,
    private config: FileLoadConfig,
  ) {}

  async bundle(): Promise<void> {
    const files = loadFilesWithIgnores(this.config);
    if (files.length === 0) {
      throw new Error(
        `No files found matching pattern: ${this.config.files?.join(", ")}`,
      );
    }

    console.log(`Found ${files.length} files for service "${this.namespace}"`);

    // Load all resolvers to get their names
    const resolvers: ResolverInfo[] = [];
    for (const file of files) {
      const resolver = await this.loader.load(file);
      if (!resolver) {
        console.log(`Skipping file ${file} as it could not be loaded`);
        continue;
      }
      resolvers.push({
        name: resolver.name,
        sourceFile: file,
      });
    }

    const outputDir = path.resolve(getDistDir(), "functions");
    const entryDir = path.resolve(getDistDir(), "resolver-entry");

    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(entryDir, { recursive: true });

    let tsconfig: string | undefined;
    try {
      tsconfig = await resolveTSConfig();
    } catch {
      tsconfig = undefined;
    }

    // Process each resolver
    await Promise.all(
      resolvers.map((resolver) =>
        this.bundleResolver(resolver, entryDir, outputDir, tsconfig),
      ),
    );

    console.log(`Successfully bundled files for service "${this.namespace}"`);
  }

  private async bundleResolver(
    resolver: ResolverInfo,
    entryDir: string,
    outputDir: string,
    tsconfig: string | undefined,
  ): Promise<void> {
    // Step 1: Create entry file that imports from the original source
    const entryPath = path.join(entryDir, `${resolver.name}__body.js`);
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
    const outputPath = path.join(outputDir, `${resolver.name}__body.js`);

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
}
