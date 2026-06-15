import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { loadFilesWithIgnores } from "@/cli/services/file-loader";
import { logger, styles } from "@/cli/shared/logger";
import { type HttpAdapterServiceInput } from "@/configure/config/types";
import {
  HTTP_METHOD_KEYS,
  HttpAdapterConfigSchema,
  type HttpMethodKey,
} from "@/parser/service/http-adapter";
import { type HttpAdapterConfig } from "@/types/http-adapter.generated";
import { isSdkBranded } from "@/utils/brand";

export type HttpAdapterServiceConfig = HttpAdapterServiceInput;

export type LoadedHttpAdapter = {
  adapter: HttpAdapterConfig;
  sourceFile: string;
  methods: HttpMethodKey[];
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
      if (adapters.length === 0) return;
      logger.newline();
      logger.log(`Found ${styles.highlight(adapters.length.toString())} HTTP adapters`);
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
  if (config.files.length === 0) {
    return { adapters: [], fileCount: 0 };
  }

  const files = loadFilesWithIgnores(config);

  // Import every matched file and keep the ones whose default export is a
  // createHttpAdapter() result, mirroring the resolver/executor loaders.
  // Matched files without one (e.g. shared helpers) are skipped.
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

async function loadAdapterFromFile(filePath: string): Promise<LoadedHttpAdapter | null> {
  try {
    const module = (await import(pathToFileURL(filePath).href)) as Record<string, unknown>;
    // Only a createHttpAdapter() result is a valid default export; a plain
    // object that happens to match the schema is rejected by the brand check.
    if (!isSdkBranded(module.default, "http-adapter")) {
      // Not an adapter file (e.g. a shared helper matched by the glob). Guard
      // against an adapter that is only exported under a named export, which
      // would otherwise silently disappear from the deployment.
      const named = Object.entries(module).find(
        ([exportName, value]) => exportName !== "default" && isSdkBranded(value, "http-adapter"),
      );
      if (named) {
        throw new Error(
          `HTTP adapter must be the default export, but it is exported as \`${named[0]}\`. ` +
            "Re-export it: `export default createHttpAdapter({...})`.",
        );
      }
      return null;
    }

    const parsed = HttpAdapterConfigSchema.safeParse(module.default);
    if (!parsed.success) {
      throw parsed.error;
    }

    const adapter = parsed.data as unknown as HttpAdapterConfig;
    const methods = collectMethodKeys(adapter);
    rejectAsyncHandlers(adapter, methods, filePath);

    return {
      adapter,
      sourceFile: filePath,
      methods,
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

function collectMethodKeys(adapter: HttpAdapterConfig): HttpMethodKey[] {
  const input = adapter.input as Partial<Record<HttpMethodKey, unknown>>;
  return HTTP_METHOD_KEYS.filter((key) => typeof input[key] === "function");
}

function rejectAsyncHandlers(
  adapter: HttpAdapterConfig,
  methods: HttpMethodKey[],
  sourceFile: string,
): void {
  const input = adapter.input as Partial<Record<HttpMethodKey, unknown>>;
  for (const method of methods) {
    if (isAsyncFunction(input[method])) {
      throw new Error(
        `HTTP adapter "${adapter.name}" in ${sourceFile} has an async \`input.${method}\` function. ` +
          `Handlers must be synchronous; async/await is not supported.`,
      );
    }
  }
  if (adapter.output !== undefined && isAsyncFunction(adapter.output)) {
    throw new Error(
      `HTTP adapter "${adapter.name}" in ${sourceFile} has an async \`output\` function. ` +
        `Handlers must be synchronous; async/await is not supported.`,
    );
  }
}

function isAsyncFunction(fn: unknown): boolean {
  return typeof fn === "function" && fn.constructor.name === "AsyncFunction";
}
