import * as path from "node:path";
import { pathToFileURL } from "node:url";

type MainFunction = (args: Record<string, unknown>) => unknown | Promise<unknown>;
type QueryResolver = (query: string, params: unknown[]) => unknown[];
type JobHandler = (jobName: string, args: unknown) => unknown;
type WaitHandler = (key: string, payload: unknown) => unknown;
type ResolveHandler = (
  executionId: string,
  key: string,
  callback: (payload: unknown) => unknown,
) => Promise<void> | void;

type IconvHandler = (
  input: string | Uint8Array | ArrayBuffer,
  fromEncoding: string,
  toEncoding: string,
) => string | Uint8Array;

interface TailordbGlobal {
  tailordb?: {
    Client: new (config: { namespace?: string }) => {
      connect(): Promise<void> | void;
      end(): Promise<void> | void;
      queryObject(
        query: string,
        params?: unknown[],
      ): Promise<{ rows: unknown[] }> | { rows: unknown[] };
    };
  };
  tailor?: {
    workflow?: {
      triggerJobFunction: (jobName: string, args: unknown) => unknown;
      wait?: (key: string, payload?: unknown) => unknown;
      resolve?: (
        executionId: string,
        key: string,
        callback: (payload: unknown) => unknown,
      ) => Promise<void>;
    };
    iconv?: {
      convert: IconvHandler;
      convertBuffer: (
        buffer: Uint8Array | ArrayBuffer,
        fromEncoding: string,
        toEncoding: string,
      ) => string | Uint8Array;
      decode: (buffer: Uint8Array | ArrayBuffer, encoding: string) => string;
      encode: (str: string, encoding: string) => string | Uint8Array;
      encodings: () => string[];
      Iconv: new (
        fromEncoding: string,
        toEncoding: string,
      ) => { convert(input: string | Uint8Array | ArrayBuffer): string | Uint8Array };
    };
  };
}

interface TailorErrorItem {
  message: string;
  path: (string | number)[];
}

interface TailorErrorsGlobal {
  TailorErrors?: new (errors: TailorErrorItem[]) => Error;
}

const GlobalThis = globalThis as TailordbGlobal & TailorErrorsGlobal;

/**
 * Sets up a mock for `globalThis.tailordb.Client` used in bundled resolver/executor tests.
 * @param resolver - Optional function to resolve query results. Defaults to returning empty arrays.
 * @returns Object containing arrays of executed queries and created clients for assertions.
 */
export function setupTailordbMock(resolver: QueryResolver = () => []): {
  executedQueries: { query: string; params: unknown[] }[];
  createdClients: { namespace?: string; ended: boolean }[];
} {
  const executedQueries: { query: string; params: unknown[] }[] = [];
  const createdClients: { namespace?: string; ended: boolean }[] = [];

  class MockTailordbClient {
    private record: { namespace?: string; ended: boolean };

    constructor({ namespace }: { namespace?: string }) {
      this.record = { namespace, ended: false };
      createdClients.push(this.record);
    }

    async connect(): Promise<void> {
      /* noop */
    }

    async end(): Promise<void> {
      this.record.ended = true;
    }

    async queryObject(query: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
      executedQueries.push({ query, params });
      return { rows: resolver(query, params) ?? [] };
    }
  }

  GlobalThis.tailordb = {
    Client: MockTailordbClient,
  } as typeof GlobalThis.tailordb;

  return { executedQueries, createdClients };
}

/**
 * Sets up a mock for `globalThis.tailor.workflow.triggerJobFunction` used in bundled workflow tests.
 * `wait`/`resolve` are stubbed to throw a helpful error directing to `setupWaitPointMock()`,
 * so mistakenly calling wait without wait-point mocks produces a clear message instead of a TypeError.
 * @param handler - Function that handles triggered job calls and returns results.
 * @returns Object containing an array of triggered jobs for assertions.
 */
export function setupWorkflowMock(handler: JobHandler): {
  triggeredJobs: { jobName: string; args: unknown }[];
} {
  const triggeredJobs: { jobName: string; args: unknown }[] = [];

  GlobalThis.tailor = {
    ...GlobalThis.tailor,
    workflow: {
      wait: () => {
        throw new Error("tailor.workflow.wait is not mocked. Use setupWaitPointMock() in tests.");
      },
      resolve: async () => {
        throw new Error(
          "tailor.workflow.resolve is not mocked. Use setupWaitPointMock() in tests.",
        );
      },
      ...GlobalThis.tailor?.workflow,
      triggerJobFunction: (jobName: string, args: unknown) => {
        triggeredJobs.push({ jobName, args });
        return handler(jobName, args);
      },
    },
  } as typeof GlobalThis.tailor;

  return { triggeredJobs };
}

/**
 * Sets up a mock for `globalThis.TailorErrors` used in bundled resolver tests.
 * Mimics the PF runtime's TailorErrors class that serializes errors with the `TailorErrors: ` prefix.
 */
export function setupTailorErrorsMock(): void {
  GlobalThis.TailorErrors = class TailorErrors extends Error {
    errors: TailorErrorItem[];

    constructor(errors: TailorErrorItem[]) {
      super(`TailorErrors: ${JSON.stringify({ errors })}`);
      this.name = "TailorErrors";
      this.errors = errors;
    }
  };
}

/**
 * Sets up mocks for `globalThis.tailor.workflow.wait` and `.resolve` used in bundled workflow tests.
 * `triggerJobFunction` is stubbed to throw a helpful error directing to `setupWorkflowMock()`,
 * so mistakenly triggering a job without job mocks produces a clear message instead of silently returning undefined.
 * @param config - Optional handlers for wait and resolve calls.
 * @param config.onWait - Handler called when wait is invoked.
 * @param config.onResolve - Handler called when resolve is invoked.
 * @returns Object containing arrays of wait and resolve calls for assertions.
 */
export function setupWaitPointMock(config?: { onWait?: WaitHandler; onResolve?: ResolveHandler }): {
  waitCalls: { key: string; payload: unknown }[];
  resolveCalls: { executionId: string; key: string }[];
} {
  const waitCalls: { key: string; payload: unknown }[] = [];
  const resolveCalls: { executionId: string; key: string }[] = [];

  GlobalThis.tailor = {
    ...GlobalThis.tailor,
    workflow: {
      triggerJobFunction: () => {
        throw new Error(
          "tailor.workflow.triggerJobFunction is not mocked. Use setupWorkflowMock() in tests.",
        );
      },
      ...GlobalThis.tailor?.workflow,
      wait: (key: string, payload?: unknown) => {
        waitCalls.push({ key, payload });
        return config?.onWait?.(key, payload);
      },
      resolve: async (
        executionId: string,
        key: string,
        callback: (payload: unknown) => unknown,
      ) => {
        resolveCalls.push({ executionId, key });
        await config?.onResolve?.(executionId, key, callback);
      },
    },
  } as typeof GlobalThis.tailor;

  return { waitCalls, resolveCalls };
}

interface IconvMockConfig {
  /** Handler for `convert` and `convertBuffer`. Defaults to passing input through unchanged. */
  onConvert?: IconvHandler;
  /** Handler for `decode`. Defaults to UTF-8 TextDecoder. */
  onDecode?: (buffer: Uint8Array | ArrayBuffer, encoding: string) => string;
  /** Handler for `encode`. Defaults to UTF-8 TextEncoder. */
  onEncode?: (str: string, encoding: string) => string | Uint8Array;
  /** Handler for `encodings`. Defaults to a small static list. */
  onEncodings?: () => string[];
}

interface IconvCall {
  method: "convert" | "convertBuffer" | "decode" | "encode" | "encodings";
  args: unknown[];
}

/**
 * Sets up a mock for `globalThis.tailor.iconv` used in unit tests of code that
 * imports from `@tailor-platform/sdk/iconv`. Defaults pass strings through and
 * use Node's TextEncoder/TextDecoder for UTF-8.
 * @param config - Optional handlers to override default behaviors.
 * @returns Object containing an array of recorded calls for assertions.
 */
export function setupIconvMock(config?: IconvMockConfig): { calls: IconvCall[] } {
  const calls: IconvCall[] = [];
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const defaultConvert: IconvHandler = (input, _from, to) => {
    if (to === "UTF8" || to === "UTF-8") {
      return typeof input === "string" ? input : decoder.decode(input);
    }
    return typeof input === "string" ? encoder.encode(input) : new Uint8Array(input);
  };

  GlobalThis.tailor = {
    ...GlobalThis.tailor,
    iconv: {
      convert: (input, from, to) => {
        calls.push({ method: "convert", args: [input, from, to] });
        return (config?.onConvert ?? defaultConvert)(input, from, to);
      },
      convertBuffer: (buffer, from, to) => {
        calls.push({ method: "convertBuffer", args: [buffer, from, to] });
        return (config?.onConvert ?? defaultConvert)(buffer, from, to);
      },
      decode: (buffer, encoding) => {
        calls.push({ method: "decode", args: [buffer, encoding] });
        return (config?.onDecode ?? ((b) => decoder.decode(b)))(buffer, encoding);
      },
      encode: (str, encoding) => {
        calls.push({ method: "encode", args: [str, encoding] });
        if (config?.onEncode) return config.onEncode(str, encoding);
        return encoding === "UTF8" || encoding === "UTF-8" ? str : encoder.encode(str);
      },
      encodings: () => {
        calls.push({ method: "encodings", args: [] });
        return (config?.onEncodings ?? (() => ["UTF-8", "Shift_JIS", "EUC-JP", "ISO-2022-JP"]))();
      },
      Iconv: class {
        constructor(
          private fromEncoding: string,
          private toEncoding: string,
        ) {}
        convert(input: string | Uint8Array | ArrayBuffer): string | Uint8Array {
          calls.push({ method: "convert", args: [input, this.fromEncoding, this.toEncoding] });
          return (config?.onConvert ?? defaultConvert)(input, this.fromEncoding, this.toEncoding);
        }
      },
    },
  };

  return { calls };
}

/**
 * Creates a function that imports a bundled JS file and returns its `main` export.
 * Used to test bundled output from `apply --buildOnly`.
 * @param baseDir - Base directory where bundled files are located.
 * @returns An async function that takes a relative path and returns the `main` function.
 */
export function createImportMain(baseDir: string): (relativePath: string) => Promise<MainFunction> {
  return async (relativePath: string): Promise<MainFunction> => {
    const fileUrl = pathToFileURL(path.join(baseDir, relativePath));
    fileUrl.searchParams.set("v", `${Date.now()}-${Math.random()}`);
    const module = await import(fileUrl.href);
    const main = module.main;
    if (typeof main !== "function") {
      throw new Error(`Expected "main" to be a function in ${relativePath}, got ${typeof main}`);
    }
    return main;
  };
}
