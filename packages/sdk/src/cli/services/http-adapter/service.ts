import * as path from "pathe";
import { loadFilesWithIgnores } from "#/cli/services/file-loader";
import { CLIError } from "#/cli/shared/errors";
import { logger, styles } from "#/cli/shared/logger";
import { importUserModule } from "#/cli/shared/user-modules";
import {
  assertUniqueDefinitionNames,
  atUserModule,
  definitionExportError,
  definitionInvalidError,
} from "#/cli/shared/validation-errors";
import { type HttpAdapterServiceInput } from "#/configure/config/types";
import {
  HTTP_METHOD_KEYS,
  HttpAdapterConfigSchema,
  type HttpMethodKey,
} from "#/parser/service/http-adapter/index";
import { type HttpAdapterConfig } from "#/types/http-adapter.generated";
import { isSdkBranded } from "#/utils/brand";

type HttpAdapterServiceConfig = HttpAdapterServiceInput;

type LoadedHttpAdapter = {
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
  /** Directory the config's file patterns are resolved against */
  baseDir: string;
}

export function createHttpAdapterService(
  params: CreateHttpAdapterServiceParams,
): HttpAdapterService {
  const { config, baseDir } = params;
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
      const result = await loadAdapterFiles(config, baseDir);
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
        logger.debug(
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
  baseDir: string,
): Promise<{ adapters: LoadedHttpAdapter[]; fileCount: number }> {
  if (config.files.length === 0) {
    return { adapters: [], fileCount: 0 };
  }

  const files = loadFilesWithIgnores(config, baseDir);

  // Import every matched file and keep the ones whose default export is a
  // createHttpAdapter() result, mirroring the resolver/executor loaders.
  // Matched files without one (e.g. shared helpers) are skipped.
  const loadResults = await Promise.all(files.map(loadAdapterFromFile));

  const adapters = loadResults.filter((result) => result !== null);
  assertUniqueDefinitionNames({
    kind: "http-adapter",
    definitions: adapters.map(({ adapter, sourceFile }) => ({
      name: adapter.name,
      file: sourceFile,
      exportName: "default",
    })),
  });

  return { adapters, fileCount: files.length };
}

async function loadAdapterFromFile(filePath: string): Promise<LoadedHttpAdapter | null> {
  try {
    const module = await importUserModule(filePath);
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
        throw definitionExportError({ kind: "http-adapter", file: filePath, exportName: named[0] });
      }
      return null;
    }

    const parsed = HttpAdapterConfigSchema.safeParse(module.default);
    if (!parsed.success) {
      throw definitionInvalidError({
        kind: "http-adapter",
        file: filePath,
        exportName: "default",
        error: parsed.error,
      });
    }

    const adapter = parsed.data;
    const methods = collectMethodKeys(adapter);
    rejectAsyncHandlers(adapter, methods);

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
    throw atUserModule(error, filePath);
  }
}

function collectMethodKeys(adapter: HttpAdapterConfig): HttpMethodKey[] {
  const input = adapter.input as Partial<Record<HttpMethodKey, unknown>>;
  return HTTP_METHOD_KEYS.filter((key) => typeof input[key] === "function");
}

function rejectAsyncHandlers(adapter: HttpAdapterConfig, methods: HttpMethodKey[]): void {
  const input = adapter.input as Partial<Record<HttpMethodKey, unknown>>;
  for (const method of methods) {
    if (isAsyncFunction(input[method])) {
      throw asyncHandlerError(adapter.name, `input.${method}`);
    }
  }
  if (adapter.output !== undefined && isAsyncFunction(adapter.output)) {
    throw asyncHandlerError(adapter.name, "output");
  }
}

function asyncHandlerError(name: string, handler: string): CLIError {
  return CLIError({
    code: "HTTP_ADAPTER_ASYNC_UNSUPPORTED",
    message: `HTTP adapter "${name}" has an async \`${handler}\` function.`,
    suggestion: "Make the handler synchronous; async/await is not supported.",
    context: { name, kind: handler },
  });
}

function isAsyncFunction(fn: unknown): boolean {
  return typeof fn === "function" && fn.constructor.name === "AsyncFunction";
}
