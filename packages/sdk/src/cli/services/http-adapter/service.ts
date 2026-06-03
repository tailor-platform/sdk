import * as fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseSync } from "oxc-parser";
import * as path from "pathe";
import { loadFilesWithIgnores } from "@/cli/services/file-loader";
import { findHttpAdaptersInFile } from "@/cli/services/http-adapter/detector";
import { logger, styles } from "@/cli/shared/logger";
import { HttpAdapterConfigSchema } from "@/parser/service/http-adapter";
import {
  HTTP_METHOD_KEYS,
  type HttpAdapterConfig,
  type HttpAdapterServiceInput,
  type HttpMethodKey,
} from "@/types/http-adapter";
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

  // First pass: AST-level validation. Reject Node-builtin imports, unknown
  // input keys, async handlers, etc., before any user code runs.
  const detections = await Promise.all(files.map(detectAdapterInFile));

  // Second pass: dynamically import only the files that the AST identified
  // as adapters. Files that match the glob but contain no createHttpAdapter
  // call are silently skipped; files that *should* export an adapter but
  // don't are surfaced as a hard error inside loadAdapterFromFile.
  const loadResults = await Promise.all(
    detections.map((detection) =>
      detection.detected ? loadAdapterFromFile(detection.sourceFile) : null,
    ),
  );

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

async function detectAdapterInFile(
  filePath: string,
): Promise<{ sourceFile: string; detected: boolean }> {
  const source = await fs.readFile(filePath, "utf8");
  const { program } = parseSync(filePath, source);
  const { adapters, errors } = findHttpAdaptersInFile(program, filePath);
  if (errors.length > 0) {
    const relativePath = path.relative(process.cwd(), filePath);
    const messages = errors.map((e) => `  - ${e.message}`).join("\n");
    throw new Error(`Invalid HTTP adapter file ${relativePath}:\n${messages}`);
  }
  return { sourceFile: filePath, detected: adapters.length > 0 };
}

async function loadAdapterFromFile(filePath: string): Promise<LoadedHttpAdapter> {
  try {
    const module = await import(pathToFileURL(filePath).href);
    const defaultExport = (module as { default?: unknown }).default;
    if (defaultExport === undefined) {
      throw new Error(
        "HTTP adapter file declared createHttpAdapter() but is missing a `default` export. " +
          "Re-export the call result: `export default createHttpAdapter({...})`.",
      );
    }

    const parsed = HttpAdapterConfigSchema.safeParse(defaultExport);
    if (!parsed.success) {
      if (isSdkBranded(defaultExport, "http-adapter")) {
        throw parsed.error;
      }
      throw new Error(
        "HTTP adapter file's `default` export is not a createHttpAdapter() result. " +
          "Make sure the default export is the value returned by createHttpAdapter().",
      );
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
          `The gateway runtime does not support async/await.`,
      );
    }
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
