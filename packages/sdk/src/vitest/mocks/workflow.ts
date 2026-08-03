import { type Mock, vi } from "vitest";
import { START_DEFAULT } from "#/configure/services/workflow/registry";
import {
  getWaitPointInvoker,
  getWaitPointKey,
} from "#/configure/services/workflow/wait-point-invoker";
import { platformSerialize } from "#/utils/test/platform-serialize";
import {
  clearWorkflowTestEnv,
  readWorkflowTestEnv,
  writeWorkflowTestEnv,
} from "../../configure/services/workflow/test-env-key";
import { tailorRoot, withDispose } from "./shared";
import type { WorkflowJob } from "#/configure/services/workflow/job";
import type {
  ParameterizedWaitPointInstance,
  WaitPointInstance,
} from "#/configure/services/workflow/wait-point";
import type { WaitPointInvoker } from "#/configure/services/workflow/wait-point-invoker";
import type { Workflow } from "#/configure/services/workflow/workflow";
import type { ExecJobFunctionOptions, StartWorkflowOptions } from "#/runtime/workflow";
import type { TailorEnv } from "../../runtime/types";

type JobHandler = (jobName: string, args: unknown, options?: ExecJobFunctionOptions) => unknown;

type StartHandlerFn = (
  workflowName: string,
  args: unknown,
  options?: StartWorkflowOptions,
) => string;
type ResumeHandlerFn = (executionId: string) => string;
type WaitHandlerFn = (key: string, payload: unknown) => unknown;
type ResolveHandler = (
  executionId: string,
  key: string,
  callback: (payload: unknown) => unknown,
) => unknown | Promise<unknown>;

// Overloaded so TypeScript narrows to WaitHandlerFn first (giving inferred
// `(key: string, payload: unknown) => …` for callers) before falling back
// to the static-value form. A union type would let `unknown` swallow the
// function variant and break inference.
type SetWaitHandler = {
  (handler: WaitHandlerFn): void;
  (handler: unknown): void;
};

interface StartedJob {
  jobName: string;
  args: unknown;
  options?: ExecJobFunctionOptions;
}

type InvokerWait = WaitPointInvoker["wait"];
type InvokerResolve = WaitPointInvoker["resolve"];

interface KeyDispatcherSlot {
  perKey: Map<string, unknown>;
  originalWait: (key: string, payload: unknown) => unknown;
  originalResolve: (
    key: string,
    executionId: string,
    callback: (payload: unknown) => unknown | Promise<unknown>,
  ) => Promise<void>;
}

// `invoker.wait`/`resolve` may already be an enclosing scope's dispatcher. Keep
// the base methods so a nested scope falls through to the platform mock rather
// than to the outer scope's per-key mocks — the same split `replaceProcedure`
// makes, where the default implementation calls the base while `restore` puts
// back the immediately preceding scope.
const baseInvokerWait = new WeakMap<InvokerWait, InvokerWait>();
const baseInvokerResolve = new WeakMap<InvokerResolve, InvokerResolve>();

interface ScopedMock {
  mockClear(): unknown;
  mockReset(): unknown;
  restore(): void;
}

type WaitPayload<Payload> = [Payload] extends [undefined] ? undefined : Payload;
type ProcedureFn = (...args: never[]) => unknown;
// `vi.spyOn` reuses an existing spy for the same property. Keep the base
// procedure separately so nested mockWorkflow scopes get independent mocks
// while disposal can still restore the immediately preceding scope.
const originalProcedures = new WeakMap<ProcedureFn, ProcedureFn>();

function replaceProcedure<Procedure extends ProcedureFn>(
  target: object,
  key: string,
  current: Procedure,
): { mock: Mock<Procedure>; scoped: ScopedMock } {
  const original = (originalProcedures.get(current) ?? current) as Procedure;
  const defaultImplementation = function (
    this: unknown,
    ...args: Parameters<Procedure>
  ): ReturnType<Procedure> {
    return Reflect.apply(original, this, args) as ReturnType<Procedure>;
  };
  const mock = vi.fn(defaultImplementation) as unknown as Mock<Procedure>;
  originalProcedures.set(mock as ProcedureFn, original);

  const record = target as Record<string, unknown>;
  record[key] = mock;

  return {
    mock,
    scoped: {
      mockClear: () => mock.mockClear(),
      mockReset: () => mock.mockReset(),
      restore: () => {
        if (record[key] === mock) record[key] = current;
      },
    },
  };
}

function replaceStart<Start extends ProcedureFn>(definition: {
  start: Start;
}): { mock: Mock<Start>; scoped: ScopedMock } {
  return replaceProcedure(definition, "start", definition.start);
}

// ---------------------------------------------------------------------------
// Workflow Mock
// ---------------------------------------------------------------------------

/**
 * Acquire a disposable mock for workflow operations (`tailor.workflow`).
 * Restored on dispose.

 * @returns Disposable workflow mock control object
 * @example
 * ```typescript
 * import { mockWorkflow } from "@tailor-platform/sdk/vitest";
 *
 * test("job start", async () => {
 *   using wf = mockWorkflow();
 *   const job = wf.job(validateOrder);
 *   job.mockResolvedValue({ valid: true });
 *   await runWorkflowUnderTest();
 *   expect(job).toHaveBeenCalled();
 * });
 * ```
 */
export function mockWorkflow() {
  const root = tailorRoot();
  const prev = root.workflow;
  const prevEnv = readWorkflowTestEnv();
  const jobSpies = new Map<object, unknown>();
  const workflowSpies = new Map<object, unknown>();
  const waitPointMocks = new Map<object, unknown>();
  const keyDispatchers = new Map<object, KeyDispatcherSlot>();
  const scopedMocks = new Set<ScopedMock>();

  // A parameterized wait point's `wait`/`resolve` live on the throwaway object
  // returned by `.with()`, so there is nothing stable to spy on. Intercept the
  // definition's invoker instead and dispatch on the resolved key.
  const installKeyDispatcher = (definition: object): KeyDispatcherSlot => {
    const cached = keyDispatchers.get(definition);
    if (cached) return cached;

    const invoker = getWaitPointInvoker(definition);
    if (!invoker) {
      throw new Error(
        "waitPointWith expects a wait point definition created by createWaitPoint or createWaitPoints.",
      );
    }
    const record = invoker as unknown as Record<string, unknown>;
    const prevWait = invoker.wait;
    const prevResolve = invoker.resolve;
    const baseWait = baseInvokerWait.get(prevWait) ?? prevWait;
    const baseResolve = baseInvokerResolve.get(prevResolve) ?? prevResolve;
    const slot: KeyDispatcherSlot = {
      perKey: new Map(),
      originalWait: (key, payload) => baseWait.call(invoker, key, payload),
      originalResolve: (key, executionId, callback) =>
        baseResolve.call(invoker, key, executionId, callback),
    };

    const dispatchWait: InvokerWait = (key, payload) => {
      const mock = slot.perKey.get(key) as { wait: Mock } | undefined;
      if (!mock) return slot.originalWait(key, payload);
      // A bound wait point always fills the payload slot, so `.wait()` arrives
      // here as an explicit `undefined`. Drop it, or the recorded call would be
      // `[undefined]` where `waitPoint()` — whose mock replaces `.wait` itself —
      // records no argument, and `toHaveBeenCalledWith()` would fail.
      return payload === undefined ? mock.wait() : mock.wait(payload);
    };
    const dispatchResolve: InvokerResolve = async (key, executionId, callback) => {
      const mock = slot.perKey.get(key) as { resolve: Mock } | undefined;
      if (!mock) return slot.originalResolve(key, executionId, callback);
      await mock.resolve(executionId, callback);
    };
    baseInvokerWait.set(dispatchWait, baseWait);
    baseInvokerResolve.set(dispatchResolve, baseResolve);
    record.wait = dispatchWait;
    record.resolve = dispatchResolve;

    const eachSpy = (fn: (spy: Mock) => unknown) => {
      for (const mock of slot.perKey.values()) {
        const pair = mock as { wait: Mock; resolve: Mock };
        fn(pair.wait);
        fn(pair.resolve);
      }
    };
    scopedMocks.add({
      mockClear: () => eachSpy((spy) => spy.mockClear()),
      mockReset: () => eachSpy((spy) => spy.mockReset()),
      restore: () => {
        record.wait = prevWait;
        record.resolve = prevResolve;
        keyDispatchers.delete(definition);
      },
    });

    keyDispatchers.set(definition, slot);
    return slot;
  };

  const defaultExecJob = (
    jobName: string,
    _args?: unknown,
    _options?: ExecJobFunctionOptions,
  ): unknown => {
    throw new Error(
      `No workflow job mock for "${jobName}". Call mockWorkflow().setJobHandler(...) or enqueueResult(...), or use runWorkflowLocally() for local workflow execution.`,
    );
  };
  const defaultStartWorkflow = async (
    _workflowName: string,
    _args?: unknown,
    _options?: StartWorkflowOptions,
  ): Promise<string> => {
    return START_DEFAULT;
  };
  const defaultResumeWorkflowExecution = async (executionId: string): Promise<string> =>
    executionId;

  // Inner vi.fns hold the overridable behavior + call recording; the installed
  // shims below cross the platform JSON boundary (serialize args + results) once.
  const execJobFunction = vi.fn(defaultExecJob);
  const startWorkflow = vi.fn(defaultStartWorkflow);
  const resumeWorkflowExecution = vi.fn(defaultResumeWorkflowExecution);
  const wait = vi.fn((_key: string, _payload?: unknown): unknown => null);
  const resolve = vi.fn(
    async (
      _executionId: string,
      _key: string,
      _callback: (payload: unknown) => unknown,
    ): Promise<void> => {},
  );

  // Preserve arity: recording `undefined` as the third element only when the
  // caller supplied it, mirroring `.execJobFunction(name, args, options)`.
  const jobFunctionShim = (...call: [string, unknown?, ExecJobFunctionOptions?]) => {
    const out =
      call.length >= 3
        ? execJobFunction(call[0], platformSerialize(call[1]), call[2])
        : execJobFunction(call[0], platformSerialize(call[1]));
    return out instanceof Promise ? out.then((v) => platformSerialize(v)) : platformSerialize(out);
  };
  // Preserve arity so a forwarded third `options` arg — even `undefined` — is
  // recorded, matching the real `.start(args, options)` call shape.
  const workflowShim = (...call: [string, unknown?, StartWorkflowOptions?]) =>
    call.length >= 3
      ? startWorkflow(call[0], platformSerialize(call[1]), call[2])
      : startWorkflow(call[0], platformSerialize(call[1]));
  const resumeShim = (executionId: string) => resumeWorkflowExecution(executionId);
  root.workflow = {
    execJobFunction: jobFunctionShim,
    startWorkflow: workflowShim,
    resumeWorkflowExecution: resumeShim,
    wait: (key: string, payload?: unknown) => wait(key, platformSerialize(payload)),
    resolve: (executionId: string, key: string, callback: (payload: unknown) => unknown) =>
      resolve(executionId, key, (payload: unknown) => {
        const out = callback(payload);
        return out instanceof Promise
          ? out.then((v) => platformSerialize(v))
          : platformSerialize(out);
      }),
  };

  const facade = {
    /** The `execJobFunction` `vi.fn`. */
    execJobFunction,
    /** The `startWorkflow` `vi.fn`. */
    startWorkflow,
    /** The `resumeWorkflowExecution` `vi.fn`. */
    resumeWorkflowExecution,
    /** The `wait` `vi.fn`. */
    wait,
    /** The `resolve` `vi.fn`. */
    resolve,

    /**
     * Get a stable, typed mock for a workflow job's `start` method.
     * The real start behavior is used until an implementation or result is configured.
     * @param definition - Workflow job definition to mock
     * @returns Typed `start` mock for the definition
     */
    job<Name extends string, Input, Output>(
      definition: WorkflowJob<Name, Input, Output>,
    ): Mock<WorkflowJob<Name, Input, Output>["start"]> {
      const existing = jobSpies.get(definition);
      if (existing) {
        return existing as Mock<WorkflowJob<Name, Input, Output>["start"]>;
      }

      const { mock, scoped } = replaceStart<WorkflowJob<Name, Input, Output>["start"]>(definition);
      scopedMocks.add(scoped);
      jobSpies.set(definition, mock);
      return mock;
    },

    /**
     * Get a stable, typed mock for a workflow definition's `start` method.
     * The real start behavior is used until an implementation or result is configured.
     * @param definition - Workflow definition to mock
     * @returns Typed `start` mock for the definition
     */
    workflow<Definition extends Workflow>(definition: Definition): Mock<Definition["start"]> {
      const existing = workflowSpies.get(definition);
      if (existing) return existing as Mock<Definition["start"]>;

      const { mock, scoped } = replaceStart<Definition["start"]>(definition);
      workflowSpies.set(definition, mock);
      scopedMocks.add(scoped);
      return mock;
    },

    /**
     * Get stable, typed mocks for a wait point's `wait` and `resolve` methods.
     * @param definition - Wait point definition to mock
     * @returns Typed wait point mock control object
     */
    waitPoint<Payload, Result>(definition: WaitPointInstance<Payload, Result>) {
      const existing = waitPointMocks.get(definition);
      if (existing) {
        return existing as {
          wait: Mock<WaitPointInstance<Payload, Result>["wait"]>;
          resolve: Mock<WaitPointInstance<Payload, Result>["resolve"]>;
          setResolvePayload(payload: WaitPayload<Payload>): void;
        };
      }

      const waitReplacement = replaceProcedure(definition, "wait", definition.wait);
      const resolveReplacement = replaceProcedure(definition, "resolve", definition.resolve);
      const waitSpy = waitReplacement.mock;
      const resolveSpy = resolveReplacement.mock;
      scopedMocks.add(waitReplacement.scoped);
      scopedMocks.add(resolveReplacement.scoped);

      const waitPointMock = {
        wait: waitSpy,
        resolve: resolveSpy,

        /**
         * Invoke the next and subsequent resolve callbacks with a wait payload.
         * @param payload - Payload originally supplied to the wait point
         */
        setResolvePayload(payload: WaitPayload<Payload>): void {
          resolveSpy.mockImplementation(async (_executionId, callback) => {
            const result = await callback(platformSerialize(payload) as WaitPayload<Payload>);
            platformSerialize(result);
          });
        },
      };

      waitPointMocks.set(definition, waitPointMock);
      return waitPointMock;
    },

    /**
     * Get stable, typed mocks for one param binding of a parameterized wait point.
     * Calls made with other bindings fall through to the platform mock.
     * @param definition - Parameterized wait point definition to mock
     * @param params - Param binding to intercept, as passed to `.with()`
     * @returns Typed wait point mock control object
     */
    waitPointWith<Params extends object, Payload, Result>(
      definition: ParameterizedWaitPointInstance<Params, Payload, Result>,
      params: Params,
    ) {
      const key = getWaitPointKey(definition.with(params));
      if (key === undefined) {
        throw new Error(
          "waitPointWith expects a wait point declared with $params. Use waitPoint() for a wait point with a fixed key.",
        );
      }
      const slot = installKeyDispatcher(definition);

      const existing = slot.perKey.get(key);
      if (existing) {
        return existing as {
          wait: Mock<WaitPointInstance<Payload, Result>["wait"]>;
          resolve: Mock<WaitPointInstance<Payload, Result>["resolve"]>;
          setResolvePayload(payload: WaitPayload<Payload>): void;
        };
      }

      // A bound wait point resolves what the invoker returns, so an unmocked
      // spy has to hand back a promise too — otherwise calling this mock
      // directly yields a raw value where its type promises one.
      const waitSpy = vi.fn((payload?: unknown) =>
        Promise.resolve(slot.originalWait(key, payload)),
      ) as unknown as Mock<WaitPointInstance<Payload, Result>["wait"]>;
      const resolveSpy = vi.fn(
        (executionId: string, callback: (payload: unknown) => unknown | Promise<unknown>) =>
          slot.originalResolve(key, executionId, callback),
      ) as unknown as Mock<WaitPointInstance<Payload, Result>["resolve"]>;
      const waitPointMock = {
        wait: waitSpy,
        resolve: resolveSpy,

        /**
         * Invoke the next and subsequent resolve callbacks with a wait payload.
         * @param payload - Payload originally supplied to the wait point
         */
        setResolvePayload(payload: WaitPayload<Payload>): void {
          (resolveSpy as unknown as Mock).mockImplementation(
            async (_executionId: string, callback: (p: unknown) => unknown) => {
              const result = await callback(platformSerialize(payload));
              platformSerialize(result);
            },
          );
        },
      };
      slot.perKey.set(key, waitPointMock);
      return waitPointMock;
    },

    /**
     * Set a fallback job handler. Called when the enqueue queue is empty.
     * @param handler - Function returning a result for a job name, args, and options
     */
    setJobHandler(handler: JobHandler): void {
      execJobFunction.mockImplementation((name, args, options) => handler(name, args, options));
    },

    /**
     * Enqueue a single result for the next `execJobFunction` call (FIFO;
     * takes priority over `setJobHandler`).
     * @param result - Result to return from the next call
     */
    enqueueResult(result: unknown): void {
      execJobFunction.mockImplementationOnce(() => result);
    },

    /**
     * Enqueue results for multiple subsequent `execJobFunction` calls (FIFO).
     * @param results - Results to enqueue, one per upcoming call
     */
    enqueueResults(...results: unknown[]): void {
      for (const result of results) {
        execJobFunction.mockImplementationOnce(() => result);
      }
    },

    /**
     * All jobs executed via `execJobFunction`, in order.
     * @returns Started jobs array
     */
    get startedJobs(): StartedJob[] {
      return execJobFunction.mock.calls.map(([jobName, args, options]) => ({
        jobName: jobName as string,
        args,
        ...(options !== undefined && { options: options as ExecJobFunctionOptions }),
      }));
    },

    /**
     * Configure what `startWorkflow` returns. Pass a string (same id every
     * call) or `(name, args, options) => string`. Default: a placeholder UUID.
     * @param handler - Static execution ID or a function returning one
     */
    setStartHandler(handler: string | StartHandlerFn): void {
      startWorkflow.mockImplementation(
        typeof handler === "function"
          ? async (name, args, options) => handler(name, args, options)
          : async () => handler,
      );
    },

    /**
     * Configure what `resumeWorkflowExecution` returns. Pass a string (same id
     * every call) or `(executionId) => string`. Default: echoes the input executionId.
     * @param handler - Static execution ID or a function returning one
     */
    setResumeHandler(handler: string | ResumeHandlerFn): void {
      resumeWorkflowExecution.mockImplementation(
        typeof handler === "function"
          ? async (executionId) => handler(executionId)
          : async () => handler,
      );
    },

    /**
     * Configure what `wait` returns. Pass `(key, payload) => unknown` or any
     * other value to return it for every call. Default: `null`.
     * @param handler - Static value or a function returning one
     */
    setWaitHandler: ((handler: unknown) => {
      wait.mockImplementation(
        typeof handler === "function"
          ? (key, payload) => (handler as WaitHandlerFn)(key, payload)
          : () => handler,
      );
    }) as SetWaitHandler,

    /**
     * Set the `env` passed to job bodies invoked via `createWorkflowJob().start()`.
     * Cleared on dispose / reset.
     * @param env - Env passed to job bodies.
     */
    setEnv(env: TailorEnv): void {
      writeWorkflowTestEnv({ ...env });
    },

    /**
     * Configure how `resolve` runs the user-supplied callback. Default: callback
     * is not invoked (records the call only).
     * @param handler - Function invoked per `resolve` call
     */
    setResolveHandler(handler: ResolveHandler): void {
      resolve.mockImplementation(async (executionId, key, callback) => {
        await handler(executionId, key, callback);
      });
    },

    /**
     * `wait` calls reshaped as `{ key, payload }` for assertions.
     * @returns Wait call records
     */
    get waitCalls(): { key: string; payload: unknown }[] {
      return wait.mock.calls.map(([key, payload]) => ({ key: key as string, payload }));
    },

    /**
     * `resolve` calls reshaped as `{ executionId, key }` for assertions.
     * @returns Resolve call records
     */
    get resolveCalls(): { executionId: string; key: string }[] {
      return resolve.mock.calls.map(([executionId, key]) => ({
        executionId: executionId as string,
        key: key as string,
      }));
    },

    /** Clear recorded calls while preserving configured responses. */
    clear(): void {
      execJobFunction.mockClear();
      startWorkflow.mockClear();
      resumeWorkflowExecution.mockClear();
      wait.mockClear();
      resolve.mockClear();
      for (const mock of scopedMocks) mock.mockClear();
    },

    /** Reset all workflow responses and recorded calls (keeps the mock installed). */
    reset(): void {
      execJobFunction.mockReset();
      execJobFunction.mockImplementation(defaultExecJob);
      startWorkflow.mockReset();
      startWorkflow.mockImplementation(defaultStartWorkflow);
      resumeWorkflowExecution.mockReset();
      resumeWorkflowExecution.mockImplementation(defaultResumeWorkflowExecution);
      wait.mockReset();
      wait.mockImplementation(() => null);
      resolve.mockReset();
      resolve.mockImplementation(async () => {});
      for (const mock of scopedMocks) mock.mockReset();
      clearWorkflowTestEnv();
    },
  };

  return withDispose(facade, () => {
    for (const mock of scopedMocks) mock.restore();
    root.workflow = prev;
    if (prevEnv !== undefined) writeWorkflowTestEnv(prevEnv);
    else clearWorkflowTestEnv();
  });
}
