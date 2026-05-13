/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  tailordbMock,
  workflowMock,
  secretmanagerMock,
  authconnectionMock,
  idpMock,
  fileMock,
  iconvMock,
  injectMocks,
  cleanupMocks,
  STATE_KEY,
  RUNTIME_FLAG_KEY,
} from "../mock";

describe("mock", () => {
  beforeEach(() => {
    injectMocks(globalThis);
  });

  afterEach(() => {
    cleanupMocks(globalThis);
  });

  describe("tailordbMock", () => {
    beforeEach(() => {
      tailordbMock.reset();
    });

    test("records executed queries", async () => {
      const client = new (globalThis as any).tailordb.Client({
        namespace: "test",
      });
      await client.connect();
      await client.queryObject("SELECT * FROM users WHERE id = $1", ["1"]);
      await client.end();

      expect(tailordbMock.executedQueries).toEqual([
        { query: "SELECT * FROM users WHERE id = $1", params: ["1"] },
      ]);
      expect(tailordbMock.createdClients).toMatchObject([{ namespace: "test", ended: true }]);
    });

    test("setQueryResolver provides content-based responses", async () => {
      tailordbMock.setQueryResolver((query) => {
        if (query.includes("SELECT")) return [{ id: "1", name: "test" }];
        return [];
      });

      const client = new (globalThis as any).tailordb.Client({});
      const result = await client.queryObject("SELECT * FROM users");

      expect(result.rows).toEqual([{ id: "1", name: "test" }]);
    });

    test("enqueueResult provides order-based responses", async () => {
      tailordbMock.enqueueResult(); // BEGIN (empty)
      tailordbMock.enqueueResult({ age: 30 }); // SELECT (one row)
      tailordbMock.enqueueResult(); // COMMIT (empty)

      const client = new (globalThis as any).tailordb.Client({});
      const r1 = await client.queryObject("BEGIN");
      const r2 = await client.queryObject("SELECT age FROM users");
      const r3 = await client.queryObject("COMMIT");

      expect(r1.rows).toEqual([]);
      expect(r2.rows).toEqual([{ age: 30 }]);
      expect(r3.rows).toEqual([]);
    });

    test("enqueueResult takes priority over queryResolver", async () => {
      tailordbMock.setQueryResolver(() => [{ fallback: true }]);
      tailordbMock.enqueueResult({ queued: true });

      const client = new (globalThis as any).tailordb.Client({});

      const r1 = await client.queryObject("query1");
      expect(r1.rows).toEqual([{ queued: true }]);

      const r2 = await client.queryObject("query2");
      expect(r2.rows).toEqual([{ fallback: true }]);
    });

    test("reset clears all state", async () => {
      tailordbMock.enqueueResult({ data: true });
      const client = new (globalThis as any).tailordb.Client({});
      await client.queryObject("test");

      tailordbMock.reset();

      expect(tailordbMock.executedQueries).toHaveLength(0);
      expect(tailordbMock.createdClients).toHaveLength(0);
    });

    test("createTransaction works", async () => {
      tailordbMock.enqueueResult(); // transaction query (empty result)

      const client = new (globalThis as any).tailordb.Client({});
      await client.connect();
      const tx = client.createTransaction("tx1");
      await tx.begin();
      const result = await tx.queryObject("SELECT 1");
      await tx.commit();

      expect(result.rows).toEqual([]);
      expect(tailordbMock.executedQueries).toHaveLength(1);
    });
  });

  describe("workflowMock", () => {
    beforeEach(() => {
      workflowMock.reset();
    });

    test("records triggered jobs", () => {
      const trigger = (globalThis as any).tailor.workflow.triggerJobFunction;
      trigger("my-job", { key: "value" });

      expect(workflowMock.triggeredJobs).toEqual([{ jobName: "my-job", args: { key: "value" } }]);
    });

    test("setJobHandler provides content-based responses", () => {
      workflowMock.setJobHandler((jobName) => {
        if (jobName === "validate") return { valid: true };
        return null;
      });

      const trigger = (globalThis as any).tailor.workflow.triggerJobFunction;
      const result = trigger("validate", {});

      expect(result).toEqual({ valid: true });
    });

    test("enqueueResults provides order-based responses", () => {
      workflowMock.enqueueResults({ step: 1 }, { step: 2 });

      const trigger = (globalThis as any).tailor.workflow.triggerJobFunction;
      expect(trigger("job1", {})).toEqual({ step: 1 });
      expect(trigger("job2", {})).toEqual({ step: 2 });
    });

    test("enqueueResult takes priority over jobHandler", () => {
      workflowMock.setJobHandler(() => ({ fallback: true }));
      workflowMock.enqueueResult({ queued: true });

      const trigger = (globalThis as any).tailor.workflow.triggerJobFunction;
      expect(trigger("job1", {})).toEqual({ queued: true });
      expect(trigger("job2", {})).toEqual({ fallback: true });
    });

    test("reset clears all state", () => {
      const trigger = (globalThis as any).tailor.workflow.triggerJobFunction;
      trigger("job", {});

      workflowMock.reset();

      expect(workflowMock.triggeredJobs).toHaveLength(0);
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

  describe("platform APIs are available", () => {
    test("tailor.secretmanager", () => {
      expect((globalThis as any).tailor.secretmanager.getSecret).toBeTypeOf("function");
      expect((globalThis as any).tailor.secretmanager.getSecrets).toBeTypeOf("function");
    });

    test("tailor.authconnection", () => {
      expect((globalThis as any).tailor.authconnection.getConnectionToken).toBeTypeOf("function");
    });

    test("tailor.idp.Client", () => {
      expect((globalThis as any).tailor.idp.Client).toBeTypeOf("function");
    });

    test("tailor.context", () => {
      expect((globalThis as any).tailor.context.getInvoker).toBeTypeOf("function");
    });

    test("tailor.iconv", () => {
      expect((globalThis as any).tailor.iconv.convert).toBeTypeOf("function");
      expect((globalThis as any).tailor.iconv.encodings).toBeTypeOf("function");
      expect((globalThis as any).tailor.iconv.Iconv).toBeTypeOf("function");
    });

    test("tailordb.file", () => {
      expect((globalThis as any).tailordb.file.upload).toBeTypeOf("function");
      expect((globalThis as any).tailordb.file.download).toBeTypeOf("function");
      expect((globalThis as any).tailordb.file.delete).toBeTypeOf("function");
    });
  });

  describe("secretmanagerMock", () => {
    beforeEach(() => {
      secretmanagerMock.reset();
    });

    test("records getSecret calls", async () => {
      await (globalThis as any).tailor.secretmanager.getSecret("vault", "key");
      expect(secretmanagerMock.calls).toEqual([
        { method: "getSecret", vault: "vault", name: "key" },
      ]);
    });

    test("records getSecrets calls", async () => {
      await (globalThis as any).tailor.secretmanager.getSecrets("vault", ["a", "b"]);
      expect(secretmanagerMock.calls).toEqual([
        { method: "getSecrets", vault: "vault", names: ["a", "b"] },
      ]);
    });

    test("setSecrets provides nested map responses", async () => {
      secretmanagerMock.setSecrets({
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
      secretmanagerMock.setSecrets({ v: { a: "1", b: "2" } });

      const result = await (globalThis as any).tailor.secretmanager.getSecrets("v", ["a", "c"]);
      expect(result).toEqual({ a: "1" });
    });

    test("reset clears store and calls", async () => {
      secretmanagerMock.setSecrets({ v: { k: "val" } });
      await (globalThis as any).tailor.secretmanager.getSecret("v", "k");
      secretmanagerMock.reset();

      expect(secretmanagerMock.calls).toHaveLength(0);
      const result = await (globalThis as any).tailor.secretmanager.getSecret("v", "k");
      expect(result).toBeUndefined();
    });
  });

  describe("authconnectionMock", () => {
    beforeEach(() => {
      authconnectionMock.reset();
    });

    test("records calls", async () => {
      await (globalThis as any).tailor.authconnection.getConnectionToken("google");
      expect(authconnectionMock.calls).toEqual([{ connectionName: "google" }]);
    });

    test("setTokens provides map-based responses", async () => {
      authconnectionMock.setTokens({
        google: { access_token: "ya29.xxx", expires_in: 3600 },
      });

      const result = await (globalThis as any).tailor.authconnection.getConnectionToken("google");
      expect(result).toEqual({ access_token: "ya29.xxx", expires_in: 3600 });
    });

    test("returns default token for unknown connection", async () => {
      const result = await (globalThis as any).tailor.authconnection.getConnectionToken("unknown");
      expect(result).toEqual({ access_token: "mock-token" });
    });

    test("reset clears tokens and calls", async () => {
      authconnectionMock.setTokens({ g: { access_token: "tok" } });
      await (globalThis as any).tailor.authconnection.getConnectionToken("g");
      authconnectionMock.reset();

      expect(authconnectionMock.calls).toHaveLength(0);
      const result = await (globalThis as any).tailor.authconnection.getConnectionToken("g");
      expect(result).toEqual({ access_token: "mock-token" });
    });
  });

  describe("idpMock", () => {
    beforeEach(() => {
      idpMock.reset();
    });

    test("records calls with method, args, namespace", async () => {
      const client = new (globalThis as any).tailor.idp.Client({ namespace: "ns" });
      await client.user("u-1");
      expect(idpMock.calls).toEqual([{ method: "user", args: ["u-1"], namespace: "ns" }]);
    });

    test("enqueueResults provides ordered responses", async () => {
      idpMock.enqueueResults({ id: "u-1", name: "alice", disabled: false }, true);

      const client = new (globalThis as any).tailor.idp.Client({ namespace: "ns" });
      const user = await client.user("u-1");
      expect(user).toEqual({ id: "u-1", name: "alice", disabled: false });

      const deleted = await client.deleteUser("u-1");
      expect(deleted).toBe(true);
    });

    test("setResolver provides content-based responses", async () => {
      idpMock.setResolver((method) => {
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
      const client = new (globalThis as any).tailor.idp.Client({ namespace: "ns" });
      await client.user("u-1");
      idpMock.reset();
      expect(idpMock.calls).toHaveLength(0);
    });

    test("default fallback is cloned so test mutations cannot leak across tests", async () => {
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

  describe("fileMock", () => {
    beforeEach(() => {
      fileMock.reset();
    });

    test("records calls", async () => {
      await (globalThis as any).tailordb.file.upload("ns", "Doc", "file", "r-1", "data");
      expect(fileMock.calls).toEqual([
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
      fileMock.enqueueResult({ metadata: { fileSize: 100, sha256sum: "abc" } });
      const result = await (globalThis as any).tailordb.file.upload("ns", "T", "f", "r", "data");
      expect(result.metadata.fileSize).toBe(100);
    });

    test("setResolver provides content-based responses", async () => {
      fileMock.setResolver((method) => {
        if (method === "getMetadata")
          return { contentType: "image/png", fileSize: 500, sha256sum: "def", urlPath: "/files/x" };
        return null;
      });
      const result = await (globalThis as any).tailordb.file.getMetadata("ns", "T", "f", "r");
      expect(result.contentType).toBe("image/png");
    });

    test("reset clears state", async () => {
      await (globalThis as any).tailordb.file.delete("ns", "T", "f", "r");
      fileMock.reset();
      expect(fileMock.calls).toHaveLength(0);
    });

    test("openDownloadStream rejects raw bytes to guide callers to structured chunks", async () => {
      fileMock.enqueueResult(new Uint8Array([1, 2, 3]));
      await expect(
        (globalThis as any).tailordb.file.openDownloadStream("ns", "T", "f", "r"),
      ).rejects.toThrow(/iterable of StreamValue items/);
    });

    test("openDownloadStream yields the enqueued StreamValue sequence", async () => {
      const bytes = new Uint8Array([1, 2, 3]);
      const sequence = [
        {
          type: "metadata" as const,
          metadata: { contentType: "application/octet-stream", fileSize: 3, sha256sum: "h" },
        },
        { type: "chunk" as const, data: bytes, position: 0 },
        { type: "complete" as const },
      ];
      fileMock.enqueueResult(sequence);
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

  describe("iconvMock", () => {
    beforeEach(() => {
      iconvMock.reset();
    });

    test("records calls", () => {
      (globalThis as any).tailor.iconv.convert("hello", "UTF-8", "Shift_JIS");
      expect(iconvMock.calls).toEqual([
        { method: "convert", args: ["hello", "UTF-8", "Shift_JIS"] },
      ]);
    });

    test("setResolver overrides responses", () => {
      iconvMock.setResolver((method) => {
        if (method === "decode") return "decoded-text";
        return null;
      });
      const result = (globalThis as any).tailor.iconv.decode(new Uint8Array([0x41]), "ASCII");
      expect(result).toBe("decoded-text");
    });

    test("reset clears calls and resolver", () => {
      (globalThis as any).tailor.iconv.encodings();
      iconvMock.reset();
      expect(iconvMock.calls).toHaveLength(0);
    });

    test("default convert returns string for UTF-8 target, Uint8Array otherwise", () => {
      const utf8Result = (globalThis as any).tailor.iconv.convert("hi", "Shift_JIS", "UTF-8");
      expect(utf8Result).toBe("");
      const binResult = (globalThis as any).tailor.iconv.convert("hi", "UTF-8", "Shift_JIS");
      expect(binResult).toBeInstanceOf(Uint8Array);
      expect(binResult).toHaveLength(0);
    });

    test("default encode returns string for UTF-8 target, Uint8Array otherwise", () => {
      const utf8Result = (globalThis as any).tailor.iconv.encode("hi", "UTF-8");
      expect(utf8Result).toBe("");
      const binResult = (globalThis as any).tailor.iconv.encode("hi", "Shift_JIS");
      expect(binResult).toBeInstanceOf(Uint8Array);
      expect(binResult).toHaveLength(0);
    });

    test("resolver returning undefined falls back to default", () => {
      // Resolvers using early-return style (`if (...) return;`) implicitly
      // return undefined for unhandled methods. That should fall through to
      // the type-consistent default rather than leaking undefined.
      iconvMock.setResolver(() => undefined as unknown as null);
      const result = (globalThis as any).tailor.iconv.convert("hi", "UTF-8", "Shift_JIS");
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result).toHaveLength(0);
    });
  });

  describe("workflowMock extended", () => {
    beforeEach(() => {
      workflowMock.reset();
    });

    test("records triggerWorkflow calls", async () => {
      await (globalThis as any).tailor.workflow.triggerWorkflow("wf-1", { key: "val" });
      expect(workflowMock.calls).toEqual([
        { method: "triggerWorkflow", args: ["wf-1", { key: "val" }, undefined] },
      ]);
    });

    test("setTriggerHandler with string controls triggerWorkflow response", async () => {
      workflowMock.setTriggerHandler("exec-123");
      const result = await (globalThis as any).tailor.workflow.triggerWorkflow("wf");
      expect(result).toBe("exec-123");
    });

    test("setTriggerHandler with function receives name/args/options", async () => {
      const seen: unknown[] = [];
      workflowMock.setTriggerHandler((name, args, options) => {
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
      (globalThis as any).tailor.workflow.wait("key", { data: 1 });
      expect(workflowMock.calls).toEqual([{ method: "wait", args: ["key", { data: 1 }] }]);
      expect(workflowMock.waitCalls).toEqual([{ key: "key", payload: { data: 1 } }]);
    });

    test("setWaitHandler with value controls wait response", () => {
      workflowMock.setWaitHandler({ approved: true });
      const result = (globalThis as any).tailor.workflow.wait("key");
      expect(result).toEqual({ approved: true });
    });

    test("setWaitHandler with function receives key/payload", () => {
      workflowMock.setWaitHandler((key: string, payload: unknown) => ({ key, payload }));
      const result = (globalThis as any).tailor.workflow.wait("approval", { reason: "ok" });
      expect(result).toEqual({ key: "approval", payload: { reason: "ok" } });
    });

    test("setResolveHandler invokes the user callback", async () => {
      const calls: unknown[] = [];
      workflowMock.setResolveHandler((executionId, key, callback) => {
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
      expect(workflowMock.resolveCalls).toEqual([{ executionId: "exec-1", key: "approval" }]);
    });

    test("resolve is recorded but callback is not invoked by default", async () => {
      let callbackRan = false;
      await (globalThis as any).tailor.workflow.resolve("exec-1", "approval", () => {
        callbackRan = true;
      });
      expect(callbackRan).toBe(false);
      expect(workflowMock.resolveCalls).toEqual([{ executionId: "exec-1", key: "approval" }]);
    });
  });

  describe("injectMocks / cleanupMocks", () => {
    test("cleanupMocks removes all globals", () => {
      cleanupMocks(globalThis);

      expect((globalThis as any).tailordb).toBeUndefined();
      expect((globalThis as any).tailor).toBeUndefined();
      expect((globalThis as any).TailorErrors).toBeUndefined();
      expect((globalThis as any).TailorErrorMessage).toBeUndefined();
      expect((globalThis as any).TailorDBFileError).toBeUndefined();
      expect((globalThis as any)[STATE_KEY]).toBeUndefined();
      expect((globalThis as any)[RUNTIME_FLAG_KEY]).toBeUndefined();
    });

    test("injectMocks sets the runtime-active flag", () => {
      // beforeEach already called injectMocks, so the flag must be set here.
      expect(RUNTIME_FLAG_KEY in globalThis).toBe(true);
    });

    test("mock helpers do not set the runtime-active flag", () => {
      // Regression test: previously, setup.ts detected the tailor-runtime
      // environment via STATE_KEY. STATE_KEY is created lazily by getState()
      // whenever any mock helper runs, so a non-tailor-runtime project that
      // simply imported and used mocks would trip the detection. The flag
      // must only be raised by injectMocks() — not by mock helpers.
      cleanupMocks(globalThis);
      expect(RUNTIME_FLAG_KEY in globalThis).toBe(false);

      tailordbMock.reset();
      // STATE_KEY should now be lazily created by getState()...
      expect(STATE_KEY in globalThis).toBe(true);
      // ...but the runtime flag must remain unset.
      expect(RUNTIME_FLAG_KEY in globalThis).toBe(false);

      // Restore for the afterEach cleanupMocks.
      injectMocks(globalThis);
    });
  });
});
