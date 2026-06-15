/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createWorkflowJob, WORKFLOW_TEST_ENV_KEY } from "../configure/services/workflow/job";
import { createWorkflow } from "../configure/services/workflow/workflow";
import {
  mockTailordb,
  mockWorkflow,
  mockSecretmanager,
  mockAuthconnection,
  mockIdp,
  mockFile,
  mockIconv,
  injectMocks,
  cleanupMocks,
  RUNTIME_FLAG_KEY,
} from "./mock";
import { runWorkflowLocally } from "./workflow-local";

describe("mock", () => {
  beforeEach(() => {
    injectMocks(globalThis);
  });

  afterEach(() => {
    cleanupMocks(globalThis);
  });

  describe("mockTailordb", () => {
    test("records executed queries", async () => {
      using db = mockTailordb();
      const client = new (globalThis as any).tailordb.Client({
        namespace: "test",
      });
      await client.connect();
      await client.queryObject("SELECT * FROM users WHERE id = $1", ["1"]);
      await client.end();

      expect(db.executedQueries).toEqual([
        { query: "SELECT * FROM users WHERE id = $1", params: ["1"] },
      ]);
      expect(db.createdClients).toMatchObject([{ namespace: "test", ended: true }]);
    });

    test("setQueryResolver provides content-based responses", async () => {
      using db = mockTailordb();
      db.setQueryResolver((query) => {
        if (query.includes("SELECT")) return [{ id: "1", name: "test" }];
        return [];
      });

      const client = new (globalThis as any).tailordb.Client({});
      const result = await client.queryObject("SELECT * FROM users");

      expect(result.rows).toEqual([{ id: "1", name: "test" }]);
    });

    test("enqueueResult provides order-based responses", async () => {
      using db = mockTailordb();
      db.enqueueResult(); // BEGIN (empty)
      db.enqueueResult({ age: 30 }); // SELECT (one row)
      db.enqueueResult(); // COMMIT (empty)

      const client = new (globalThis as any).tailordb.Client({});
      const r1 = await client.queryObject("BEGIN");
      const r2 = await client.queryObject("SELECT age FROM users");
      const r3 = await client.queryObject("COMMIT");

      expect(r1.rows).toEqual([]);
      expect(r2.rows).toEqual([{ age: 30 }]);
      expect(r3.rows).toEqual([]);
    });

    test("enqueueResult takes priority over queryResolver", async () => {
      using db = mockTailordb();
      db.setQueryResolver(() => [{ fallback: true }]);
      db.enqueueResult({ queued: true });

      const client = new (globalThis as any).tailordb.Client({});

      const r1 = await client.queryObject("query1");
      expect(r1.rows).toEqual([{ queued: true }]);

      const r2 = await client.queryObject("query2");
      expect(r2.rows).toEqual([{ fallback: true }]);
    });

    test("reset clears all state", async () => {
      using db = mockTailordb();
      db.enqueueResult({ data: true });
      const client = new (globalThis as any).tailordb.Client({});
      await client.queryObject("test");

      db.reset();

      expect(db.executedQueries).toHaveLength(0);
      expect(db.createdClients).toHaveLength(0);
    });

    test("createTransaction works", async () => {
      using db = mockTailordb();
      db.enqueueResult(); // transaction query (empty result)

      const client = new (globalThis as any).tailordb.Client({});
      await client.connect();
      const tx = client.createTransaction("tx1");
      await tx.begin();
      const result = await tx.queryObject("SELECT 1");
      await tx.commit();

      expect(result.rows).toEqual([]);
      expect(db.executedQueries).toHaveLength(1);
    });
  });

  describe("mockWorkflow", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    test("records triggered jobs even when no handler is configured", () => {
      using wf = mockWorkflow();
      const trigger = (globalThis as any).tailor.workflow.triggerJobFunction;
      expect(() => trigger("my-job", { key: "value" })).toThrow(/No workflow job mock/);

      expect(wf.triggeredJobs).toEqual([{ jobName: "my-job", args: { key: "value" } }]);
    });

    test("setJobHandler provides content-based responses", () => {
      using wf = mockWorkflow();
      wf.setJobHandler((jobName) => {
        if (jobName === "validate") return { valid: true };
        return null;
      });

      const trigger = (globalThis as any).tailor.workflow.triggerJobFunction;
      const result = trigger("validate", {});

      expect(result).toEqual({ valid: true });
    });

    test("enqueueResults provides order-based responses", () => {
      using wf = mockWorkflow();
      wf.enqueueResults({ step: 1 }, { step: 2 });

      const trigger = (globalThis as any).tailor.workflow.triggerJobFunction;
      expect(trigger("job1", {})).toEqual({ step: 1 });
      expect(trigger("job2", {})).toEqual({ step: 2 });
    });

    test("enqueueResult takes priority over jobHandler", () => {
      using wf = mockWorkflow();
      wf.setJobHandler(() => ({ fallback: true }));
      wf.enqueueResult({ queued: true });

      const trigger = (globalThis as any).tailor.workflow.triggerJobFunction;
      expect(trigger("job1", {})).toEqual({ queued: true });
      expect(trigger("job2", {})).toEqual({ fallback: true });
    });

    test("reset clears all state", () => {
      using wf = mockWorkflow();
      const trigger = (globalThis as any).tailor.workflow.triggerJobFunction;
      expect(() => trigger("job", {})).toThrow(/No workflow job mock/);

      wf.reset();

      expect(wf.triggeredJobs).toHaveLength(0);
    });

    test("setEnv exposes env to job bodies via runWorkflowLocally()", async () => {
      using wf = mockWorkflow();
      const captureEnv = createWorkflowJob({
        name: "capture-env",
        body: (_input: undefined, ctx) => ctx.env,
      });
      const workflow = createWorkflow({ name: "capture-env-workflow", mainJob: captureEnv });

      wf.setEnv({ STAGE: "test", REGION: "asia" });
      const env = await runWorkflowLocally(workflow);

      expect(env).toEqual({ STAGE: "test", REGION: "asia" });
    });

    test("runWorkflowLocally env option overrides and restores the mock env", async () => {
      using wf = mockWorkflow();
      const captureEnv = createWorkflowJob({
        name: "capture-env-option",
        body: (_input: undefined, ctx) => ctx.env,
      });
      const workflow = createWorkflow({ name: "capture-env-option-workflow", mainJob: captureEnv });

      wf.setEnv({ STAGE: "from-mock" });

      expect(
        await runWorkflowLocally(workflow, undefined, { env: { STAGE: "from-option" } }),
      ).toEqual({ STAGE: "from-option" });
      expect(await runWorkflowLocally(workflow)).toEqual({ STAGE: "from-mock" });
    });

    test("reset clears env back to {}", async () => {
      using wf = mockWorkflow();
      const captureEnv = createWorkflowJob({
        name: "capture-env-reset",
        body: (_input: undefined, ctx) => ctx.env,
      });
      const workflow = createWorkflow({ name: "capture-env-reset-workflow", mainJob: captureEnv });

      wf.setEnv({ STAGE: "test" });
      wf.reset();

      expect(await runWorkflowLocally(workflow)).toEqual({});
    });

    describe("backward-compat: deprecated WORKFLOW_TEST_ENV_KEY env-var", () => {
      test("setEnv takes priority over the env-var", async () => {
        using wf = mockWorkflow();
        const captureEnv = createWorkflowJob({
          name: "capture-env-compat-priority",
          body: (_input: undefined, ctx) => ctx.env,
        });
        const workflow = createWorkflow({
          name: "capture-env-compat-priority-workflow",
          mainJob: captureEnv,
        });

        vi.stubEnv(WORKFLOW_TEST_ENV_KEY, JSON.stringify({ STAGE: "fallback" }));
        wf.setEnv({ STAGE: "from-setenv" });

        expect(await runWorkflowLocally(workflow)).toEqual({ STAGE: "from-setenv" });
      });

      test("env-var is used when setEnv has not been called", async () => {
        const captureEnv = createWorkflowJob({
          name: "capture-env-compat-fallback",
          body: (_input: undefined, ctx) => ctx.env,
        });
        const workflow = createWorkflow({
          name: "capture-env-compat-fallback-workflow",
          mainJob: captureEnv,
        });

        vi.stubEnv(WORKFLOW_TEST_ENV_KEY, JSON.stringify({ STAGE: "from-env-var" }));

        expect(await runWorkflowLocally(workflow)).toEqual({ STAGE: "from-env-var" });
      });

      test("throws when the env-var is valid JSON but not an object", async () => {
        using _wf = mockWorkflow();
        const captureEnv = createWorkflowJob({
          name: "capture-env-compat-nonobject",
          body: (_input: undefined, ctx) => ctx.env,
        });
        const workflow = createWorkflow({
          name: "capture-env-compat-nonobject-workflow",
          mainJob: captureEnv,
        });

        vi.stubEnv(WORKFLOW_TEST_ENV_KEY, "42");

        await expect(runWorkflowLocally(workflow)).rejects.toThrow(/must be a JSON object/);
      });
    });
  });

  describe("default workflow runtime (no mockWorkflow needed)", () => {
    test("a job's .trigger() requires a configured workflow mock", () => {
      const double = createWorkflowJob({
        name: "default-runtime-double",
        body: (input: { n: number }) => ({ doubled: input.n * 2 }),
      });

      expect(() => double.trigger({ n: 21 })).toThrow(/No workflow job mock/);
    });

    test("workflow.trigger() returns an execution id without running the main job", async () => {
      let bodyRan = false;
      const main = createWorkflowJob({
        name: "default-runtime-main-trigger",
        body: () => {
          bodyRan = true;
          return { ok: true };
        },
      });
      const workflow = createWorkflow({ name: "default-runtime-trigger-wf", mainJob: main });

      await expect(workflow.trigger(undefined)).resolves.toBe(
        "00000000-0000-4000-8000-000000000000",
      );
      expect(bodyRan).toBe(false);
    });

    test("workflow.trigger() validates args in the default runtime", async () => {
      const main = createWorkflowJob({
        name: "default-runtime-trigger-args",
        body: (input: { when: string }) => ({ when: input.when }),
      });
      const workflow = createWorkflow({ name: "default-runtime-trigger-args-wf", mainJob: main });

      await expect(workflow.trigger({ when: new Date() } as never)).rejects.toThrow(
        /Date instance/,
      );
    });

    test("runWorkflowLocally() runs the whole chain", async () => {
      const inner = createWorkflowJob({
        name: "default-runtime-inner",
        body: async (input: { n: number }) => ({ n: input.n + 1 }),
      });
      const main = createWorkflowJob({
        name: "default-runtime-main",
        body: async (input: { n: number }) => {
          const a = inner.trigger({ n: input.n });
          const b = inner.trigger({ n: a.n });
          return { total: b.n };
        },
      });
      const workflow = createWorkflow({ name: "default-runtime-wf", mainJob: main });

      expect(await runWorkflowLocally(workflow, { n: 0 })).toEqual({ total: 2 });
    });

    test("runWorkflowLocally() clones cached trigger results on replay", async () => {
      const mutable = createWorkflowJob({
        name: "default-runtime-mutable",
        body: () => ({ items: [] as string[] }),
      });
      const step = createWorkflowJob({
        name: "default-runtime-step",
        body: () => ({ ok: true }),
      });
      const main = createWorkflowJob({
        name: "default-runtime-mutation-main",
        body: () => {
          const result = mutable.trigger();
          result.items.push("x");
          step.trigger();
          return result;
        },
      });
      const workflow = createWorkflow({
        name: "default-runtime-mutation-wf",
        mainJob: main,
      });

      expect(await runWorkflowLocally(workflow)).toEqual({ items: ["x"] });
    });

    test("runWorkflowLocally() hides replay signals from user catch blocks", async () => {
      const inner = createWorkflowJob({
        name: "default-runtime-caught-inner",
        body: async () => ({ ok: true }),
      });
      const main = createWorkflowJob({
        name: "default-runtime-caught-main",
        body: () => {
          try {
            return inner.trigger();
          } catch {
            return { ok: false };
          }
        },
      });
      const workflow = createWorkflow({
        name: "default-runtime-caught-wf",
        mainJob: main,
      });

      expect(await runWorkflowLocally(workflow)).toEqual({ ok: true });
    });

    test("runWorkflowLocally() replays failed trigger errors into user catch blocks once", async () => {
      let attempts = 0;
      const inner = createWorkflowJob({
        name: "default-runtime-failing-inner",
        body: async () => {
          attempts += 1;
          throw new Error("inner failed");
        },
      });
      const main = createWorkflowJob({
        name: "default-runtime-failing-main",
        body: () => {
          try {
            inner.trigger();
            return { handled: false, message: "" };
          } catch (cause) {
            return { handled: true, message: (cause as Error).message };
          }
        },
      });
      const workflow = createWorkflow({
        name: "default-runtime-failing-wf",
        mainJob: main,
      });

      expect(await runWorkflowLocally(workflow)).toEqual({
        handled: true,
        message: "inner failed",
      });
      expect(attempts).toBe(1);
    });

    test("runWorkflowLocally() validates nested workflow trigger args", async () => {
      const innerMain = createWorkflowJob({
        name: "default-runtime-nested-workflow-inner",
        body: (_input: { when: string }) => ({ ok: true }),
      });
      const innerWorkflow = createWorkflow({
        name: "default-runtime-nested-workflow",
        mainJob: innerMain,
      });
      const main = createWorkflowJob({
        name: "default-runtime-nested-workflow-main",
        body: async () => {
          await innerWorkflow.trigger({ when: new Date() } as never);
          return { ok: true };
        },
      });
      const workflow = createWorkflow({
        name: "default-runtime-nested-workflow-wf",
        mainJob: main,
      });

      await expect(runWorkflowLocally(workflow)).rejects.toThrow(/Date instance/);
    });

    test("runWorkflowLocally() rejects a non-serializable trigger result", async () => {
      const bad = createWorkflowJob({
        name: "default-runtime-bad",
        body: () => ({ when: new Date() }) as never,
      });
      const workflow = createWorkflow({ name: "default-runtime-bad-wf", mainJob: bad });

      await expect(runWorkflowLocally(workflow)).rejects.toThrow(/Date instance/);
    });
  });

  describe("error classes", () => {
    test("TailorErrors serializes correctly", () => {
      const TailorErrors = (globalThis as any).TailorErrors;
      const err = new TailorErrors([{ message: "invalid", path: ["field"] }]);

      expect(err.name).toBe("TailorErrors");
      expect(err.errors).toEqual([{ message: "invalid", path: ["field"] }]);
      expect(err.message).toMatch(/^TailorErrors: /);
      const parsed = JSON.parse(err.message.replace(/^TailorErrors: /, ""));
      expect(parsed.errors).toEqual([{ message: "invalid", path: ["field"] }]);
    });

    test("TailorErrorMessage works", () => {
      const TailorErrorMessage = (globalThis as any).TailorErrorMessage;
      const err = new TailorErrorMessage("test message");

      expect(err.name).toBe("TailorErrorMessage");
      expect(err.message).toBe("test message");
    });

    test("TailorDBFileError works", () => {
      const TailorDBFileError = (globalThis as any).TailorDBFileError;
      const err = new TailorDBFileError("not found", "NOT_FOUND");

      expect(err.name).toBe("TailorDBFileError");
      expect(err.code).toBe("NOT_FOUND");
    });
  });

  describe("platform APIs are installed on acquire", () => {
    test("tailor.secretmanager", () => {
      using _sm = mockSecretmanager();
      expect((globalThis as any).tailor.secretmanager.getSecret).toBeTypeOf("function");
      expect((globalThis as any).tailor.secretmanager.getSecrets).toBeTypeOf("function");
    });

    test("tailor.authconnection", () => {
      using _ac = mockAuthconnection();
      expect((globalThis as any).tailor.authconnection.getConnectionToken).toBeTypeOf("function");
    });

    test("tailor.idp.Client", () => {
      using _idp = mockIdp();
      expect((globalThis as any).tailor.idp.Client).toBeTypeOf("function");
    });

    test("tailor.context is part of the always-present base surface", () => {
      expect((globalThis as any).tailor.context.getInvoker).toBeTypeOf("function");
    });

    test("tailor.iconv", () => {
      using _iconv = mockIconv();
      expect((globalThis as any).tailor.iconv.convert).toBeTypeOf("function");
      expect((globalThis as any).tailor.iconv.encodings).toBeTypeOf("function");
      expect((globalThis as any).tailor.iconv.Iconv).toBeTypeOf("function");
    });

    test("tailordb.file", () => {
      using _file = mockFile();
      expect((globalThis as any).tailordb.file.upload).toBeTypeOf("function");
      expect((globalThis as any).tailordb.file.download).toBeTypeOf("function");
      expect((globalThis as any).tailordb.file.delete).toBeTypeOf("function");
    });
  });

  describe("mockSecretmanager", () => {
    test("records getSecret calls", async () => {
      using sm = mockSecretmanager();
      await (globalThis as any).tailor.secretmanager.getSecret("vault", "key");
      expect(sm.calls).toEqual([{ method: "getSecret", vault: "vault", name: "key" }]);
    });

    test("records getSecrets calls", async () => {
      using sm = mockSecretmanager();
      await (globalThis as any).tailor.secretmanager.getSecrets("vault", ["a", "b"]);
      expect(sm.calls).toEqual([{ method: "getSecrets", vault: "vault", names: ["a", "b"] }]);
    });

    test("setSecrets provides nested map responses", async () => {
      using sm = mockSecretmanager();
      sm.setSecrets({
        "my-vault": { API_KEY: "sk-123", DB_PASS: "secret" },
      });

      const result = await (globalThis as any).tailor.secretmanager.getSecret(
        "my-vault",
        "API_KEY",
      );
      expect(result).toBe("sk-123");

      const missing = await (globalThis as any).tailor.secretmanager.getSecret(
        "my-vault",
        "UNKNOWN",
      );
      expect(missing).toBeUndefined();
    });

    test("getSecrets returns partial record from store", async () => {
      using sm = mockSecretmanager();
      sm.setSecrets({ v: { a: "1", b: "2" } });

      const result = await (globalThis as any).tailor.secretmanager.getSecrets("v", ["a", "c"]);
      expect(result).toEqual({ a: "1" });
    });

    test("reset clears store and calls", async () => {
      using sm = mockSecretmanager();
      sm.setSecrets({ v: { k: "val" } });
      await (globalThis as any).tailor.secretmanager.getSecret("v", "k");
      sm.reset();

      expect(sm.calls).toHaveLength(0);
      const result = await (globalThis as any).tailor.secretmanager.getSecret("v", "k");
      expect(result).toBeUndefined();
    });

    test("disposal restores the seeded store instead of wiping it", async () => {
      // Seed secrets once outside the test (as setup.ts does from
      // tailor.config.ts), installed and left in place (no `using`, not disposed).
      const seed = mockSecretmanager();
      seed.setSecrets({ seeded: { GLOBAL: "from-config" } });

      {
        using sm = mockSecretmanager();
        // The seeded store is inherited (cloned) on acquisition.
        expect(await (globalThis as any).tailor.secretmanager.getSecret("seeded", "GLOBAL")).toBe(
          "from-config",
        );

        sm.setSecrets({ override: { LOCAL: "per-test" } });
        await (globalThis as any).tailor.secretmanager.getSecret("override", "LOCAL");
        expect(sm.calls).toHaveLength(2);
      } // dispose restores the seeded install

      // The per-test override is gone, but the globally seeded secret survives.
      expect(
        await (globalThis as any).tailor.secretmanager.getSecret("override", "LOCAL"),
      ).toBeUndefined();
      expect(await (globalThis as any).tailor.secretmanager.getSecret("seeded", "GLOBAL")).toBe(
        "from-config",
      );
    });
  });

  describe("mockAuthconnection", () => {
    test("records calls", async () => {
      using ac = mockAuthconnection();
      await (globalThis as any).tailor.authconnection.getConnectionToken("google");
      expect(ac.calls).toEqual([{ connectionName: "google" }]);
    });

    test("setTokens provides map-based responses", async () => {
      using ac = mockAuthconnection();
      ac.setTokens({
        google: { access_token: "ya29.xxx", expires_in: 3600 },
      });

      const result = await (globalThis as any).tailor.authconnection.getConnectionToken("google");
      expect(result).toEqual({ access_token: "ya29.xxx", expires_in: 3600 });
    });

    test("returns default token for unknown connection", async () => {
      using _ac = mockAuthconnection();
      const result = await (globalThis as any).tailor.authconnection.getConnectionToken("unknown");
      expect(result).toEqual({ access_token: "mock-token" });
    });

    test("reset clears tokens and calls", async () => {
      using ac = mockAuthconnection();
      ac.setTokens({ g: { access_token: "tok" } });
      await (globalThis as any).tailor.authconnection.getConnectionToken("g");
      ac.reset();

      expect(ac.calls).toHaveLength(0);
      const result = await (globalThis as any).tailor.authconnection.getConnectionToken("g");
      expect(result).toEqual({ access_token: "mock-token" });
    });
  });

  describe("mockIdp", () => {
    test("records calls with method, args, namespace", async () => {
      using idp = mockIdp();
      const client = new (globalThis as any).tailor.idp.Client({ namespace: "ns" });
      await client.user("u-1");
      expect(idp.calls).toEqual([{ method: "user", args: ["u-1"], namespace: "ns" }]);
    });

    test("enqueueResults provides ordered responses", async () => {
      using idp = mockIdp();
      idp.enqueueResults({ id: "u-1", name: "alice", disabled: false }, true);

      const client = new (globalThis as any).tailor.idp.Client({ namespace: "ns" });
      const user = await client.user("u-1");
      expect(user).toEqual({ id: "u-1", name: "alice", disabled: false });

      const deleted = await client.deleteUser("u-1");
      expect(deleted).toBe(true);
    });

    test("setResolver provides content-based responses", async () => {
      using idp = mockIdp();
      idp.setResolver((method) => {
        if (method === "users")
          return {
            users: [{ id: "u-1", name: "bob", disabled: false }],
            nextPageToken: null,
            totalCount: 1,
          };
        return null;
      });

      const client = new (globalThis as any).tailor.idp.Client({ namespace: "ns" });
      const result = await client.users();
      expect(result.users).toHaveLength(1);
    });

    test("reset clears state", async () => {
      using idp = mockIdp();
      const client = new (globalThis as any).tailor.idp.Client({ namespace: "ns" });
      await client.user("u-1");
      idp.reset();
      expect(idp.calls).toHaveLength(0);
    });

    test("default fallback is cloned so test mutations cannot leak across tests", async () => {
      using _idp = mockIdp();
      // resolveIdpCall returns IDP_DEFAULTS[method] when no enqueue/resolver
      // is configured. Without cloning, mutating the returned `users` array
      // would persist across tests in the same worker.
      const client = new (globalThis as any).tailor.idp.Client({ namespace: "ns" });
      const first = (await client.users()) as { users: unknown[] };
      first.users.push({ id: "leaked", name: "leak", disabled: false });
      const second = (await client.users()) as { users: unknown[] };
      expect(second.users).toEqual([]);
    });
  });

  describe("mockFile", () => {
    test("records calls", async () => {
      using file = mockFile();
      await (globalThis as any).tailordb.file.upload("ns", "Doc", "file", "r-1", "data");
      expect(file.calls).toEqual([
        {
          method: "upload",
          namespace: "ns",
          typeName: "Doc",
          fieldName: "file",
          recordId: "r-1",
        },
      ]);
    });

    test("enqueueResult provides ordered responses", async () => {
      using file = mockFile();
      file.enqueueResult({ metadata: { fileSize: 100, sha256sum: "abc" } });
      const result = await (globalThis as any).tailordb.file.upload("ns", "T", "f", "r", "data");
      expect(result.metadata.fileSize).toBe(100);
    });

    test("setResolver provides content-based responses", async () => {
      using file = mockFile();
      file.setResolver((method) => {
        if (method === "getMetadata")
          return { contentType: "image/png", fileSize: 500, sha256sum: "def", urlPath: "/files/x" };
        return null;
      });
      const result = await (globalThis as any).tailordb.file.getMetadata("ns", "T", "f", "r");
      expect(result.contentType).toBe("image/png");
    });

    test("reset clears state", async () => {
      using file = mockFile();
      await (globalThis as any).tailordb.file.delete("ns", "T", "f", "r");
      file.reset();
      expect(file.calls).toHaveLength(0);
    });

    test("openDownloadStream rejects raw bytes to guide callers to structured chunks", async () => {
      using file = mockFile();
      file.enqueueResult(new Uint8Array([1, 2, 3]));
      await expect(
        (globalThis as any).tailordb.file.openDownloadStream("ns", "T", "f", "r"),
      ).rejects.toThrow(/iterable of StreamValue items/);
    });

    test("openDownloadStream rejects non-StreamValue elements yielded by the iterable", async () => {
      using file = mockFile();
      // Uint8Array[] is iterable but its elements aren't StreamValue items.
      file.enqueueResult([new Uint8Array([1]), new Uint8Array([2])]);
      const stream = await (globalThis as any).tailordb.file.openDownloadStream(
        "ns",
        "T",
        "f",
        "r",
      );
      await expect(stream.next()).rejects.toThrow(/StreamValue/);
    });

    test("openDownloadStream yields the enqueued StreamValue sequence", async () => {
      using file = mockFile();
      const bytes = new Uint8Array([1, 2, 3]);
      const sequence = [
        {
          type: "metadata" as const,
          metadata: { contentType: "application/octet-stream", fileSize: 3, sha256sum: "h" },
        },
        { type: "chunk" as const, data: bytes, position: 0 },
        { type: "complete" as const },
      ];
      file.enqueueResult(sequence);
      const stream = await (globalThis as any).tailordb.file.openDownloadStream(
        "ns",
        "T",
        "f",
        "r",
      );
      const chunks: unknown[] = [];
      for await (const chunk of stream) chunks.push(chunk);
      expect(chunks).toEqual(sequence);
    });

    test("default fallback is cloned so test mutations cannot leak across tests", async () => {
      using _file = mockFile();
      // resolveFileCall returns FILE_DEFAULTS[method] when no enqueue/resolver
      // is configured. Without cloning, mutating the returned `data` payload
      // would persist across tests in the same worker.
      const first = (await (globalThis as any).tailordb.file.download("ns", "T", "f", "r")) as {
        data: Uint8Array;
        metadata: { fileSize: number };
      };
      first.metadata.fileSize = 9999;
      const second = (await (globalThis as any).tailordb.file.download("ns", "T", "f", "r")) as {
        data: Uint8Array;
        metadata: { fileSize: number };
      };
      expect(second.metadata.fileSize).toBe(0);
    });
  });

  describe("mockIconv", () => {
    test("records calls", () => {
      using iconv = mockIconv();
      (globalThis as any).tailor.iconv.convert("hello", "UTF-8", "Shift_JIS");
      expect(iconv.calls).toEqual([{ method: "convert", args: ["hello", "UTF-8", "Shift_JIS"] }]);
    });

    test("setResolver overrides responses", () => {
      using iconv = mockIconv();
      iconv.setResolver((method) => {
        if (method === "decode") return "decoded-text";
        return null;
      });
      const result = (globalThis as any).tailor.iconv.decode(new Uint8Array([0x41]), "ASCII");
      expect(result).toBe("decoded-text");
    });

    test("reset clears calls and resolver", () => {
      using iconv = mockIconv();
      (globalThis as any).tailor.iconv.encodings();
      iconv.reset();
      expect(iconv.calls).toHaveLength(0);
    });

    test("default convert returns string for UTF-8 target, Uint8Array otherwise", () => {
      using _iconv = mockIconv();
      const utf8Result = (globalThis as any).tailor.iconv.convert("hi", "Shift_JIS", "UTF-8");
      expect(utf8Result).toBe("");
      const binResult = (globalThis as any).tailor.iconv.convert("hi", "UTF-8", "Shift_JIS");
      expect(binResult).toBeInstanceOf(Uint8Array);
      expect(binResult).toHaveLength(0);
    });

    test("default encode returns string for UTF-8 target, Uint8Array otherwise", () => {
      using _iconv = mockIconv();
      const utf8Result = (globalThis as any).tailor.iconv.encode("hi", "UTF-8");
      expect(utf8Result).toBe("");
      const binResult = (globalThis as any).tailor.iconv.encode("hi", "Shift_JIS");
      expect(binResult).toBeInstanceOf(Uint8Array);
      expect(binResult).toHaveLength(0);
    });

    test("resolver returning undefined falls back to default", () => {
      using iconv = mockIconv();
      // Resolvers using early-return style (`if (...) return;`) implicitly
      // return undefined for unhandled methods. That should fall through to
      // the type-consistent default rather than leaking undefined.
      iconv.setResolver(() => undefined as unknown as null);
      const result = (globalThis as any).tailor.iconv.convert("hi", "UTF-8", "Shift_JIS");
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result).toHaveLength(0);
    });
  });

  describe("mockWorkflow extended", () => {
    test("records triggerWorkflow calls", async () => {
      using wf = mockWorkflow();
      await (globalThis as any).tailor.workflow.triggerWorkflow("wf-1", { key: "val" });
      expect(wf.triggerWorkflow.mock.calls).toEqual([["wf-1", { key: "val" }]]);
    });

    test("preserves a forwarded third options arg even when undefined", async () => {
      using wf = mockWorkflow();
      await (globalThis as any).tailor.workflow.triggerWorkflow("wf-1", { key: "val" }, undefined);
      expect(wf.triggerWorkflow.mock.calls).toEqual([["wf-1", { key: "val" }, undefined]]);
    });

    test("setTriggerHandler with string controls triggerWorkflow response", async () => {
      using wf = mockWorkflow();
      wf.setTriggerHandler("exec-123");
      const result = await (globalThis as any).tailor.workflow.triggerWorkflow("wf");
      expect(result).toBe("exec-123");
    });

    test("setTriggerHandler with function receives name/args/options", async () => {
      using wf = mockWorkflow();
      const seen: unknown[] = [];
      wf.setTriggerHandler((name, args, options) => {
        seen.push({ name, args, options });
        return `exec-${name}`;
      });
      const result = await (globalThis as any).tailor.workflow.triggerWorkflow(
        "wf",
        { key: "val" },
        { authInvoker: { namespace: "ns", machineUserName: "mu" } },
      );
      expect(result).toBe("exec-wf");
      expect(seen).toEqual([
        {
          name: "wf",
          args: { key: "val" },
          options: { authInvoker: { namespace: "ns", machineUserName: "mu" } },
        },
      ]);
    });

    test("records wait calls", () => {
      using wf = mockWorkflow();
      (globalThis as any).tailor.workflow.wait("key", { data: 1 });
      expect(wf.wait.mock.calls).toEqual([["key", { data: 1 }]]);
      expect(wf.waitCalls).toEqual([{ key: "key", payload: { data: 1 } }]);
    });

    test("setWaitHandler with value controls wait response", () => {
      using wf = mockWorkflow();
      wf.setWaitHandler({ approved: true });
      const result = (globalThis as any).tailor.workflow.wait("key");
      expect(result).toEqual({ approved: true });
    });

    test("setWaitHandler with function receives key/payload", () => {
      using wf = mockWorkflow();
      wf.setWaitHandler((key: string, payload: unknown) => ({ key, payload }));
      const result = (globalThis as any).tailor.workflow.wait("approval", { reason: "ok" });
      expect(result).toEqual({ key: "approval", payload: { reason: "ok" } });
    });

    test("setResolveHandler invokes the user callback", async () => {
      using wf = mockWorkflow();
      const calls: unknown[] = [];
      wf.setResolveHandler((executionId, key, callback) => {
        calls.push({ executionId, key });
        return callback({ approved: true });
      });
      await (globalThis as any).tailor.workflow.resolve(
        "exec-1",
        "approval",
        (payload: unknown) => {
          calls.push({ payload });
        },
      );
      expect(calls).toEqual([
        { executionId: "exec-1", key: "approval" },
        { payload: { approved: true } },
      ]);
      expect(wf.resolveCalls).toEqual([{ executionId: "exec-1", key: "approval" }]);
    });

    test("resolve is recorded but callback is not invoked by default", async () => {
      using wf = mockWorkflow();
      let callbackRan = false;
      await (globalThis as any).tailor.workflow.resolve("exec-1", "approval", () => {
        callbackRan = true;
      });
      expect(callbackRan).toBe(false);
      expect(wf.resolveCalls).toEqual([{ executionId: "exec-1", key: "approval" }]);
    });
  });

  describe("injectMocks / cleanupMocks (base platform globals)", () => {
    test("cleanupMocks removes the base globals", () => {
      cleanupMocks(globalThis);

      expect((globalThis as any).tailordb).toBeUndefined();
      expect((globalThis as any).tailor).toBeUndefined();
      expect((globalThis as any).TailorErrors).toBeUndefined();
      expect((globalThis as any).TailorErrorMessage).toBeUndefined();
      expect((globalThis as any).TailorDBFileError).toBeUndefined();
      expect((globalThis as any)[RUNTIME_FLAG_KEY]).toBeUndefined();
    });

    test("injectMocks sets the runtime-active flag and the base surface", () => {
      // beforeEach already called injectMocks, so the flag and base must be set.
      expect(RUNTIME_FLAG_KEY in globalThis).toBe(true);
      expect((globalThis as any).tailor.context.getInvoker).toBeTypeOf("function");
      expect((globalThis as any).TailorErrors).toBeTypeOf("function");
    });

    test("a mock overlays the default workflow runner and dispose restores it", () => {
      const base = (globalThis as any).tailor.workflow;
      expect(base.triggerJobFunction).toBeTypeOf("function");
      {
        using _wf = mockWorkflow();
        expect((globalThis as any).tailor.workflow).not.toBe(base);
        expect((globalThis as any).tailor.workflow.triggerJobFunction).toBeTypeOf("function");
      }
      expect((globalThis as any).tailor.workflow).toBe(base);
    });
  });
});
