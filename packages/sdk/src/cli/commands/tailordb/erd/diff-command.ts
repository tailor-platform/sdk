import * as fs from "node:fs";
import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import {
  buildErdDiffViewerSchema,
  buildErdSchemaDiff,
  createEmptyErdSchema,
  extractEmbeddedErdSchema,
  renderErdDiffHtml,
  type ErdSchemaDiff,
} from "./diff";
import { initErdCommand } from "./utils";
import type { TailorDbErdSchema } from "./types";

export interface WriteErdDiffOptions {
  baseHtml?: string;
  headHtml?: string;
  namespace?: string;
  outputHtml: string;
  outputJson?: string;
}

export interface WriteErdDiffResult {
  namespace: string;
  outputHtml: string;
  outputJson?: string;
  diff: ErdSchemaDiff;
}

interface ResolveNamespaceOptions {
  namespace?: string;
  base?: TailorDbErdSchema;
  head?: TailorDbErdSchema;
}

function readSchema(filePath: string | undefined): TailorDbErdSchema | undefined {
  if (!filePath) return undefined;
  return extractEmbeddedErdSchema(fs.readFileSync(filePath, "utf8"));
}

function resolveNamespace(options: ResolveNamespaceOptions): string {
  const namespace = options.namespace ?? options.head?.namespace ?? options.base?.namespace;
  if (!namespace) {
    throw new Error("Missing --namespace when one side of the ERD diff is omitted.");
  }
  if (options.base && options.base.namespace !== namespace) {
    throw new Error(
      `Base ERD namespace "${options.base.namespace}" does not match "${namespace}".`,
    );
  }
  if (options.head && options.head.namespace !== namespace) {
    throw new Error(
      `Head ERD namespace "${options.head.namespace}" does not match "${namespace}".`,
    );
  }
  return namespace;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

export function writeErdDiff(options: WriteErdDiffOptions): WriteErdDiffResult {
  const base = readSchema(options.baseHtml);
  const head = readSchema(options.headHtml);
  if (!base && !head) {
    throw new Error("At least one of --base-html or --head-html is required.");
  }

  const namespace = resolveNamespace({ namespace: options.namespace, base, head });
  const baseSchema = base ?? createEmptyErdSchema({ namespace, revision: "missing-base" });
  const headSchema = head ?? createEmptyErdSchema({ namespace, revision: "missing-head" });
  const diff = buildErdSchemaDiff({ base: baseSchema, head: headSchema });
  const viewerSchema = buildErdDiffViewerSchema({ base: baseSchema, head: headSchema });

  writeFile(options.outputHtml, renderErdDiffHtml({ schema: viewerSchema, diff }));
  if (options.outputJson) {
    writeFile(options.outputJson, `${JSON.stringify(diff, null, 2)}\n`);
  }

  return {
    namespace,
    outputHtml: options.outputHtml,
    outputJson: options.outputJson,
    diff,
  };
}

export const erdDiffCommand = defineAppCommand({
  name: "diff",
  description: "Render TailorDB ERD schema diff HTML from exported ERD viewers.",
  args: z
    .object({
      "base-html": arg(z.string().optional(), {
        description: "Base ERD viewer HTML file",
        completion: { type: "file", matcher: [".html"] },
      }),
      "head-html": arg(z.string().optional(), {
        description: "Head ERD viewer HTML file",
        completion: { type: "file", matcher: [".html"] },
      }),
      namespace: arg(z.string().optional(), {
        alias: "n",
        description: "TailorDB namespace name (defaults to the provided ERD schema namespace)",
      }),
      output: arg(z.string().min(1), {
        alias: "o",
        description: "Output ERD diff HTML file",
        completion: { type: "file", matcher: [".html"] },
      }),
      "output-json": arg(z.string().optional(), {
        description: "Optional output JSON file for the computed diff",
        completion: { type: "file", matcher: [".json"] },
      }),
    })
    .strict(),
  run: (args) => {
    initErdCommand();
    const result = writeErdDiff({
      baseHtml: args["base-html"],
      headHtml: args["head-html"],
      namespace: args.namespace,
      outputHtml: args.output,
      outputJson: args["output-json"],
    });

    if (args.json) {
      logger.out({
        namespace: result.namespace,
        outputHtml: result.outputHtml,
        outputJson: result.outputJson,
        summary: result.diff.summary,
      });
    } else {
      logger.success(`Wrote ERD diff to ${path.relative(process.cwd(), result.outputHtml)}`);
    }
  },
});
