/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { tailordbMock, workflowMock, injectMocks, cleanupMocks } from "../mock";

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

    test("enqueueResult provides order-based responses", () => {
      workflowMock.enqueueResult({ step: 1 }, { step: 2 });

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
      const parsed = JSON.parse(err.message);
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

  describe("unimplemented APIs", () => {
    test("tailor.secretmanager throws", () => {
      expect(() => (globalThis as any).tailor.secretmanager.getSecret).toThrow("not implemented");
    });

    test("tailor.iconv throws", () => {
      expect(() => (globalThis as any).tailor.iconv.convert).toThrow("not implemented");
    });

    test("tailordb.file throws", () => {
      expect(() => (globalThis as any).tailordb.file.upload).toThrow("not implemented");
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
    });
  });
});
