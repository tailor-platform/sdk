import * as fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseSync } from "oxc-parser";
import * as path from "pathe";
import { loadFilesWithIgnores } from "@/cli/services/file-loader";
import { findHttpAdaptersInFile } from "@/cli/services/http-adapter/detector";
import { logger, styles } from "@/cli/shared/logger";
import { HttpAdapterConfigSchema } from "@/parser/service/http-adapter";
import { isSdkBranded } from "@/utils/brand";
import type { HttpAdapterConfig, HttpAdapterServiceInput } from "@/types/http-adapter";

export type HttpAdapterServiceConfig = HttpAdapterServiceInput;

export type LoadedHttpAdapter = {
  adapter: HttpAdapterConfig;
  sourceFile: string;
  hasOutput: boolean;
};

export type HttpAdapterService = {
  readonly config: HttpAdapterServiceConfig;
  readonly adapters: ReadonlyArray<LoadedHttpAdapter>;
  readonly fileCount: number;
  loadAdapters: () => Promise<void>;
  printLoadedAdapters: () => void;
};

export interface CreateHttpAdapterServiceParams {
  config: HttpAdapterServiceConfig;
}

export function createHttpAdapterService(
  params: CreateHttpAdapterServiceParams,
): HttpAdapterService {
  const { config } = params;
  let adapters: LoadedHttpAdapter[] = [];
  let fileCount = 0;
  let loaded = false;

  return {
    config,
    get adapters() {
      return adapters;
    },
    get fileCount() {
      return fileCount;
    },
    loadAdapters: async () => {
      if (loaded) return;
      const result = await loadAdapterFiles(config);
      adapters = result.adapters;
      fileCount = result.fileCount;
      loaded = true;
    },
    printLoadedAdapters: () => {
      if (fileCount === 0) return;
      logger.newline();
      logger.log(`Found ${styles.highlight(fileCount.toString())} HTTP adapter files`);
      for (const { adapter, sourceFile } of adapters) {
        const relativePath = path.relative(process.cwd(), sourceFile);
        logger.log(
          `HTTP adapter: ${styles.successBright(
            `"${adapter.name}"`,
          )} loaded from ${styles.path(relativePath)}`,
        );
      }
    },
  };
}

async function loadAdapterFiles(
  config: HttpAdapterServiceConfig,
): Promise<{ adapters: LoadedHttpAdapter[]; fileCount: number }> {
  if (!config.files || config.files.length === 0) {
    return { adapters: [], fileCount: 0 };
  }

  const files = loadFilesWithIgnores(config);

  // Validate AST-level constraints up front so we don't execute (dynamically
  // import) any adapter module unless its file structure is valid.
  await Promise.all(files.map(validateAdapterFile));

  const loadResults = await Promise.all(files.map(loadAdapterFromFile));

  const adapters: LoadedHttpAdapter[] = [];
  const seenNames = new Map<string, string>();
  for (const result of loadResults) {
    if (!result) continue;
    const existing = seenNames.get(result.adapter.name);
    if (existing) {
      throw new Error(
        `Duplicate HTTP adapter name "${result.adapter.name}" found:\n` +
          `  - ${existing}\n` +
          `  - ${result.sourceFile}\n` +
          `Each HTTP adapter must have a unique name.`,
      );
    }
    seenNames.set(result.adapter.name, result.sourceFile);
    adapters.push(result);
  }

  return { adapters, fileCount: files.length };
}

async function validateAdapterFile(filePath: string): Promise<void> {
  const source = await fs.readFile(filePath, "utf8");
  const { program } = parseSync(filePath, source);
  const { errors } = findHttpAdaptersInFile(program, filePath);
  if (errors.length === 0) return;
  const relativePath = path.relative(process.cwd(), filePath);
  const messages = errors.map((e) => `  - ${e.message}`).join("\n");
  throw new Error(`Invalid HTTP adapter file ${relativePath}:\n${messages}`);
}

async function loadAdapterFromFile(filePath: string): Promise<LoadedHttpAdapter | null> {
  try {
    const module = await import(pathToFileURL(filePath).href);
    const defaultExport = (module as { default?: unknown }).default;
    if (defaultExport === undefined) {
      return null;
    }

    const parsed = HttpAdapterConfigSchema.safeParse(defaultExport);
    if (!parsed.success) {
      if (isSdkBranded(defaultExport, "http-adapter")) {
        throw parsed.error;
      }
      return null;
    }

    const adapter = parsed.data as unknown as HttpAdapterConfig;
    rejectAsyncHandlers(adapter, filePath);

    return {
      adapter,
      sourceFile: filePath,
      hasOutput: adapter.output !== undefined,
    };
  } catch (error) {
    const relativePath = path.relative(process.cwd(), filePath);
    logger.error(
      `${styles.error("Failed to load HTTP adapter from")} ${styles.errorBright(relativePath)}`,
    );
    logger.error(String(error));
    throw error;
  }
}

function rejectAsyncHandlers(adapter: HttpAdapterConfig, sourceFile: string): void {
  if (isAsyncFunction(adapter.input)) {
    throw new Error(
      `HTTP adapter "${adapter.name}" in ${sourceFile} has an async \`input\` function. ` +
        `The gateway runtime does not support async/await.`,
    );
  }
  if (adapter.output !== undefined && isAsyncFunction(adapter.output)) {
    throw new Error(
      `HTTP adapter "${adapter.name}" in ${sourceFile} has an async \`output\` function. ` +
        `The gateway runtime does not support async/await.`,
    );
  }
}

function isAsyncFunction(fn: unknown): boolean {
  return typeof fn === "function" && fn.constructor?.name === "AsyncFunction";
}
