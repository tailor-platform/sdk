/* eslint-disable @typescript-eslint/no-explicit-any */
import { aroundEach, describe, expect, expectTypeOf, test, vi } from "vitest";
import { createWorkflowJob } from "../configure/services/workflow/job";
import { createWaitPoint, createWaitPoints } from "../configure/services/workflow/wait-point";
import { createWorkflow } from "../configure/services/workflow/workflow";
import {
  injectMocks,
  mockAigateway,
  mockAuthconnection,
  mockFile,
  mockIconv,
  mockIdp,
  mockSecretmanager,
  mockTailordb,
  mockWorkflow,
} from "./mock";

const lookupCustomer = createWorkflowJob({
  name: "mock-ergonomics-lookup-customer",
  body: async (input: { customerId: string }): Promise<{ customerId: string; source: string }> => ({
    customerId: input.customerId,
    source: "real",
  }),
});

const customerWorkflow = createWorkflow({
  name: "mock-ergonomics-customer-workflow",
  mainJob: lookupCustomer,
});

const approval = createWaitPoint<{ message: string }, { approved: boolean }>(
  "mock-ergonomics-approval",
);

const { lineApproval, silentStep } = createWaitPoints((define) => ({
  lineApproval: define("mock-ergonomics-line-$lineId")<
    { message: string },
    { approved: boolean }
  >(),
  silentStep: define("mock-ergonomics-silent-$lineId")<undefined, { seen: boolean }>(),
}));

describe("ergonomic runtime mocks", () => {
  aroundEach(async (runTest) => {
    using _mocks = injectMocks(globalThis);
    await runTest();
  });

  test("matches TailorDB queries without coupling responses to global call order", async () => {
    using db = mockTailordb();
    db.onQuery({ sql: /FROM users/i, params: ["u-1"] }).returnsRows([{ id: "u-1", name: "Alice" }]);
    db.onQuery(/FROM audit_logs/i)
      .returnsRowsOnce([{ id: "log-1" }])
      .returnsRows([{ id: "log-2" }]);

    const client = new (globalThis as any).tailordb.Client({});

    await expect(
      client.queryObject("SELECT * FROM users WHERE id = $1", ["u-1"]),
    ).resolves.toMatchObject({ rows: [{ id: "u-1", name: "Alice" }] });
    await expect(client.queryObject("SELECT * FROM audit_logs")).resolves.toMatchObject({
      rows: [{ id: "log-1" }],
    });
    await expect(client.queryObject("SELECT * FROM audit_logs")).resolves.toMatchObject({
      rows: [{ id: "log-2" }],
    });
  });

  test("keeps an explicit TailorDB rows queue for sequence-sensitive tests", async () => {
    using db = mockTailordb();
    db.enqueueRows([], [{ age: 30 }], []);

    const client = new (globalThis as any).tailordb.Client({});
    await expect(client.queryObject("BEGIN")).resolves.toMatchObject({ rows: [] });
    await expect(client.queryObject("SELECT age FROM users")).resolves.toMatchObject({
      rows: [{ age: 30 }],
    });
    await expect(client.queryObject("COMMIT")).resolves.toMatchObject({ rows: [] });
  });

  test("rejects configured and unhandled TailorDB queries in strict mode", async () => {
    using db = mockTailordb({ onUnhandled: "error" });
    db.onQuery(/DELETE FROM users/i).rejects(new Error("delete failed"));

    const client = new (globalThis as any).tailordb.Client({});
    await expect(client.queryObject("DELETE FROM users")).rejects.toThrow("delete failed");
    await expect(client.queryObject("SELECT * FROM users")).rejects.toThrow(
      "No TailorDB query behavior matched",
    );
  });

  test("uses shared fallback vocabulary across service mocks", async () => {
    using db = mockTailordb({ onUnhandled: "fallback" });
    using auth = mockAuthconnection({ onUnhandled: "fallback" });
    using idp = mockIdp({ onUnhandled: "fallback" });
    using file = mockFile({ onUnhandled: "fallback" });
    using iconv = mockIconv({ onUnhandled: "fallback" });

    await expect(db.queryObject("SELECT 1")).resolves.toMatchObject({ rows: [] });
    await expect(auth.getConnectionToken("unknown")).resolves.toEqual({
      access_token: "mock-token",
    });
    await expect(idp.namespace("customer-idp").deleteUser("u-1")).resolves.toBe(true);
    await expect(file.delete("main", "Document", "attachment", "record-1")).resolves.toBe(
      undefined,
    );
    expect(iconv.decode(new Uint8Array(), "UTF-8")).toBe("");
  });

  test("matches TailorDB query parameters structurally without JSON coercion", async () => {
    using db = mockTailordb({ onUnhandled: "error" });
    db.onQuery({ sql: "SELECT object", params: [{ a: 1, b: 2 }] }).returnsRows([
      { matched: "object" },
    ]);
    db.onQuery({ sql: "SELECT number", params: [null] }).returnsRows([{ matched: "null" }]);
    db.onQuery({ sql: "SELECT date", params: [new Date("2026-01-01")] }).returnsRows([
      { matched: "date" },
    ]);
    db.onQuery({ sql: "SELECT bytes", params: [new Uint8Array([1, 2, 3])] }).returnsRows([
      { matched: "bytes" },
    ]);

    const client = new (globalThis as any).tailordb.Client({});

    await expect(client.queryObject("SELECT object", [{ b: 2, a: 1 }])).resolves.toMatchObject({
      rows: [{ matched: "object" }],
    });
    await expect(client.queryObject("SELECT number", [Number.NaN])).rejects.toThrow(
      "No TailorDB query behavior matched",
    );
    await expect(
      client.queryObject("SELECT date", [new Date("2026-01-01")]),
    ).resolves.toMatchObject({ rows: [{ matched: "date" }] });
    await expect(
      client.queryObject("SELECT bytes", [new Uint8Array([1, 2, 3])]),
    ).resolves.toMatchObject({ rows: [{ matched: "bytes" }] });
  });

  test("preserves a TailorDB query matcher's regular expression state", async () => {
    using db = mockTailordb();
    const sql = /SELECT/g;
    sql.lastIndex = 2;
    db.onQuery(sql).returnsRows([{ matched: true }]);

    await expect(db.queryObject("SELECT")).resolves.toMatchObject({
      rows: [{ matched: true }],
    });
    expect(sql.lastIndex).toBe(2);
  });

  test("returns typed workflow definition mocks", async () => {
    using wf = mockWorkflow();
    const job = wf.job(lookupCustomer);
    const workflow = wf.workflow(customerWorkflow);

    job.mockResolvedValue({ customerId: "c-1", source: "mock" });
    workflow.mockResolvedValue("execution-1");

    await expect(lookupCustomer.start({ customerId: "c-1" })).resolves.toEqual({
      customerId: "c-1",
      source: "mock",
    });
    await expect(customerWorkflow.start({ customerId: "c-1" })).resolves.toBe("execution-1");
    expect(job).toHaveBeenCalledWith({ customerId: "c-1" });
    expect(workflow).toHaveBeenCalledWith({ customerId: "c-1" });
  });

  test("returns typed wait-point mocks for wait and resolve paths", async () => {
    using wf = mockWorkflow();
    const waitPoint = wf.waitPoint(approval);
    waitPoint.wait.mockResolvedValue({ approved: true });

    await expect(approval.wait({ message: "Approve this" })).resolves.toEqual({ approved: true });
    expect(waitPoint.wait).toHaveBeenCalledWith({ message: "Approve this" });

    waitPoint.setResolvePayload({ message: "Approve that" });
    const callback = vi.fn(() => ({ approved: false }));
    await approval.resolve("execution-1", callback);

    expect(callback).toHaveBeenCalledWith({ message: "Approve that" });
    expect(waitPoint.resolve).toHaveBeenCalledWith("execution-1", callback);
  });

  test("scopes parameterized wait-point mocks to one param binding", async () => {
    using wf = mockWorkflow();
    const lineOne = wf.waitPointWith(lineApproval, { lineId: "one" });
    lineOne.wait.mockResolvedValue({ approved: true });

    await expect(
      lineApproval.with({ lineId: "one" }).wait({ message: "Approve line one" }),
    ).resolves.toEqual({ approved: true });
    expect(lineOne.wait).toHaveBeenCalledWith({ message: "Approve line one" });

    // A different binding is a different key, so this mock must not see it.
    const lineTwo = wf.waitPointWith(lineApproval, { lineId: "two" });
    lineTwo.wait.mockResolvedValue({ approved: false });
    await expect(
      lineApproval.with({ lineId: "two" }).wait({ message: "Approve line two" }),
    ).resolves.toEqual({ approved: false });
    expect(lineOne.wait).toHaveBeenCalledTimes(1);

    lineOne.setResolvePayload({ message: "Approve line one" });
    const callback = vi.fn(() => ({ approved: true }));
    await lineApproval.with({ lineId: "one" }).resolve("execution-1", callback);
    expect(callback).toHaveBeenCalledWith({ message: "Approve line one" });
    expect(lineOne.resolve).toHaveBeenCalledWith("execution-1", callback);
  });

  test("an unconfigured parameterized wait mock still answers with a promise", () => {
    using wf = mockWorkflow();
    const lineOne = wf.waitPointWith(lineApproval, { lineId: "one" });

    // Its type promises one, and `waitPoint()` gives one, so falling through
    // to the platform mock must not hand back a raw value.
    expect(lineOne.wait({ message: "unconfigured" })).toBeInstanceOf(Promise);
  });

  test("records a no-payload parameterized wait the same way waitPoint does", async () => {
    using wf = mockWorkflow();
    const noPayload = wf.waitPointWith(silentStep, { lineId: "one" });
    noPayload.wait.mockResolvedValue({ seen: true });

    await silentStep.with({ lineId: "one" }).wait();

    // Not `toHaveBeenCalledWith(undefined)`: the bound wait point fills the
    // payload slot internally, which must not leak into the recorded call.
    expect(noPayload.wait).toHaveBeenCalledWith();
  });

  test("isolates definition mocks across nested workflow scopes", async () => {
    using outer = mockWorkflow();
    const outerJob = outer.job(lookupCustomer);
    const outerWorkflow = outer.workflow(customerWorkflow);
    const outerWaitPoint = outer.waitPoint(approval);
    const outerLine = outer.waitPointWith(lineApproval, { lineId: "one" });
    outerJob.mockResolvedValue({ customerId: "c-1", source: "outer" });
    outerWorkflow.mockResolvedValue("outer-execution");
    outerWaitPoint.wait.mockResolvedValue({ approved: true });
    outerLine.wait.mockResolvedValue({ approved: true });

    {
      using inner = mockWorkflow();
      const innerJob = inner.job(lookupCustomer);
      const innerWorkflow = inner.workflow(customerWorkflow);
      const innerWaitPoint = inner.waitPoint(approval);
      const innerLine = inner.waitPointWith(lineApproval, { lineId: "one" });
      expect(innerJob).not.toBe(outerJob);
      expect(innerWorkflow).not.toBe(outerWorkflow);
      expect(innerWaitPoint.wait).not.toBe(outerWaitPoint.wait);
      expect(innerLine.wait).not.toBe(outerLine.wait);
      // An unconfigured inner binding falls through to the platform mock, not
      // to the outer scope's per-key mock, which would answer `{ approved: true }`.
      await expect(
        lineApproval.with({ lineId: "one" }).wait({ message: "inner" }),
      ).resolves.toBeNull();
      // A fresh inner scope does not inherit the outer scope's configured
      // resolved value; the unconfigured start falls through to the real
      // dispatch, which throws without a low-level job handler.
      expect(() => lookupCustomer.start({ customerId: "c-1" })).toThrow(/No workflow job mock for/);

      innerJob.mockResolvedValue({ customerId: "c-1", source: "inner" });
      innerWorkflow.mockResolvedValue("inner-execution");
      innerWaitPoint.wait.mockResolvedValue({ approved: false });
      innerLine.wait.mockResolvedValue({ approved: false });

      await expect(lookupCustomer.start({ customerId: "c-1" })).resolves.toMatchObject({
        source: "inner",
      });
      await expect(customerWorkflow.start({ customerId: "c-1" })).resolves.toBe("inner-execution");
      await expect(approval.wait({ message: "inner" })).resolves.toEqual({ approved: false });
      await expect(
        lineApproval.with({ lineId: "one" }).wait({ message: "inner" }),
      ).resolves.toEqual({ approved: false });
    }

    await expect(lookupCustomer.start({ customerId: "c-1" })).resolves.toMatchObject({
      source: "outer",
    });
    await expect(customerWorkflow.start({ customerId: "c-1" })).resolves.toBe("outer-execution");
    await expect(approval.wait({ message: "outer" })).resolves.toEqual({ approved: true });
    await expect(lineApproval.with({ lineId: "one" }).wait({ message: "outer" })).resolves.toEqual({
      approved: true,
    });
  });

  test("initializes and incrementally updates Secret Manager fixtures", async () => {
    using secrets = mockSecretmanager({
      secrets: { app: { API_KEY: "initial" } },
    });
    secrets.setSecret("app", "API_KEY", "override");
    secrets.mergeSecrets("app", { DB_PASSWORD: "password" });

    await expect(secrets.getSecret("app", "API_KEY")).resolves.toBe("override");
    await expect(secrets.getSecrets("app", ["API_KEY", "DB_PASSWORD"])).resolves.toEqual({
      API_KEY: "override",
      DB_PASSWORD: "password",
    });
  });

  test("initializes AuthConnection tokens and can fail on an unhandled name", async () => {
    using auth = mockAuthconnection({
      tokens: { google: { access_token: "initial" } },
      onUnhandled: "error",
    });
    auth.setToken("google", { access_token: "override" });

    await expect(auth.getConnectionToken("google")).resolves.toEqual({
      access_token: "override",
    });
    await expect(auth.getConnectionToken("unknown")).rejects.toThrow(
      'No AuthConnection token configured for "unknown"',
    );
  });

  test("routes IdP clients to typed namespace-specific method mocks", async () => {
    using idp = mockIdp({ onUnhandled: "error" });
    const namespace = idp.namespace("customer-idp");
    namespace.users.mockResolvedValue({ users: [], nextPageToken: null, totalCount: 0 });
    namespace.user.mockResolvedValue({
      id: "u-1",
      name: "alice",
      disabled: false,
      mfaEnrolled: false,
      mfaFactorIds: [],
    });
    namespace.deleteUser.mockResolvedValue(true);

    const client = new (globalThis as any).tailor.idp.Client({ namespace: "customer-idp" });
    await expect(client.users()).resolves.toMatchObject({ users: [] });
    await expect(client.user("u-1")).resolves.toMatchObject({ name: "alice" });
    await expect(client.deleteUser("u-1")).resolves.toBe(true);

    expect(namespace.users).toHaveBeenCalledWith();
    expect(namespace.user).toHaveBeenCalledWith("u-1");
    expect(namespace.deleteUser).toHaveBeenCalledWith("u-1");
    expect(idp.calls[0]).toEqual({
      method: "users",
      args: [undefined],
      namespace: "customer-idp",
    });
  });

  test("exposes every File operation as a typed Vitest mock", async () => {
    using file = mockFile({ onUnhandled: "error" });
    const response = {
      data: new Uint8Array([1, 2, 3]),
      metadata: {
        contentType: "application/octet-stream",
        fileSize: 3,
        sha256sum: "hash",
        lastUploadedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    file.download
      .mockRejectedValueOnce(new Error("file not found"))
      .mockResolvedValueOnce(response);

    const args = ["main", "Document", "attachment", "record-1"] as const;
    await expect((globalThis as any).tailordb.file.download(...args)).rejects.toThrow(
      "file not found",
    );
    await expect((globalThis as any).tailordb.file.download(...args)).resolves.toEqual(response);
    expect(file.download).toHaveBeenNthCalledWith(2, ...args);
  });

  test("exposes Iconv operations as typed Vitest mocks", () => {
    using iconv = mockIconv();
    iconv.decode.mockReturnValue("decoded");
    iconv.encodings.mockReturnValue(["UTF-8", "Shift_JIS"]);

    const bytes = new Uint8Array([0x41]);
    expect((globalThis as any).tailor.iconv.decode(bytes, "Shift_JIS")).toBe("decoded");
    expect((globalThis as any).tailor.iconv.encodings()).toEqual(["UTF-8", "Shift_JIS"]);
    expect(iconv.decode).toHaveBeenCalledWith(bytes, "Shift_JIS");
  });

  test("preserves Iconv conditional return types and rejects invalid mock values", () => {
    using iconv = mockIconv();
    const bytes = new Uint8Array([0x41]);

    expectTypeOf(iconv.convert(bytes, "Shift_JIS", "UTF-8")).toEqualTypeOf<string>();
    expectTypeOf(iconv.convert(bytes, "UTF-8", "Shift_JIS")).toEqualTypeOf<Uint8Array>();
    iconv.convert.mockReturnValue(new Uint8Array());
    iconv.convertBuffer.mockReturnValue("decoded");
    iconv.encode.mockReturnValue(new Uint8Array());

    // @ts-expect-error Iconv conversion mocks only accept runtime-compatible results.
    iconv.convert.mockReturnValue(42);
    // @ts-expect-error Iconv conversion mocks only accept runtime-compatible results.
    iconv.convertBuffer.mockReturnValue({ invalid: true });
    // @ts-expect-error Iconv conversion mocks only accept runtime-compatible results.
    iconv.encode.mockReturnValue(null);
  });

  test("initializes AI Gateway URLs and updates one URL", async () => {
    using ai = mockAigateway({ urls: { assistant: "https://initial.example.com" } });
    ai.setUrl("assistant", "https://override.example.com");

    await expect(ai.get("assistant")).resolves.toEqual({
      url: "https://override.example.com",
    });
  });

  test("keeps bulk fixture maps live until an incremental update", async () => {
    using ai = mockAigateway();
    using auth = mockAuthconnection();
    using secrets = mockSecretmanager();
    const urls = { assistant: "https://initial.example.com" };
    const tokens = { google: { access_token: "initial" } };
    const secretStore = { app: { API_KEY: "initial" } };

    ai.setUrls(urls);
    auth.setTokens(tokens);
    secrets.setSecrets(secretStore);
    urls.assistant = "https://updated.example.com";
    tokens.google = { access_token: "updated" };
    secretStore.app.API_KEY = "updated";

    await expect(ai.get("assistant")).resolves.toEqual({
      url: "https://updated.example.com",
    });
    await expect(auth.getConnectionToken("google")).resolves.toEqual({ access_token: "updated" });
    await expect(secrets.getSecret("app", "API_KEY")).resolves.toBe("updated");
  });

  test("does not mutate bulk fixture inputs during incremental updates", () => {
    using ai = mockAigateway();
    using auth = mockAuthconnection();
    using secrets = mockSecretmanager();
    const urls = { assistant: "https://initial.example.com" };
    const tokens = { google: { access_token: "initial" } };
    const secretStore = { app: { API_KEY: "initial" } };

    ai.setUrls(urls);
    auth.setTokens(tokens);
    secrets.setSecrets(secretStore);
    ai.setUrl("assistant", "https://override.example.com");
    auth.setToken("google", { access_token: "override" });
    secrets.setSecret("app", "API_KEY", "override");

    expect(urls.assistant).toBe("https://initial.example.com");
    expect(tokens.google.access_token).toBe("initial");
    expect(secretStore.app.API_KEY).toBe("initial");
  });

  test("forwards runtime method receivers to typed mock implementations", async () => {
    using file = mockFile();
    using idp = mockIdp();
    using iconv = mockIconv();
    const fileResponse = {
      data: new Uint8Array(),
      metadata: { contentType: "", fileSize: 0, sha256sum: "", lastUploadedAt: "" },
    };
    const user = {
      id: "u-1",
      name: "alice",
      disabled: false,
      mfaEnrolled: false,
      mfaFactorIds: [],
    };

    file.download.mockImplementation(async function (this: unknown) {
      expect(this).toBe((globalThis as any).tailordb.file);
      return fileResponse;
    });
    idp.namespace("customer-idp").user.mockImplementation(async function (this: unknown) {
      expect(this).toBe(idpClient);
      return user;
    });
    iconv.decode.mockImplementation(function (this: unknown) {
      expect(this).toBe((globalThis as any).tailor.iconv);
      return "decoded";
    });

    const idpClient = new (globalThis as any).tailor.idp.Client({ namespace: "customer-idp" });
    const iconvInstance = new (globalThis as any).tailor.iconv.Iconv("UTF-8", "Shift_JIS");
    iconv.convert.mockImplementation(function (this: unknown) {
      expect(this).toBe(iconvInstance);
      return new Uint8Array();
    });
    await (globalThis as any).tailordb.file.download("main", "Doc", "file", "r-1");
    await idpClient.user("u-1");
    (globalThis as any).tailor.iconv.decode(new Uint8Array(), "UTF-8");
    iconvInstance.convert("hello");
  });

  test("clears calls without clearing configured behavior", async () => {
    using file = mockFile();
    file.download.mockResolvedValue({
      data: new Uint8Array(),
      metadata: {
        contentType: "",
        fileSize: 0,
        sha256sum: "",
        lastUploadedAt: "",
      },
    });
    const args = ["main", "Document", "attachment", "record-1"] as const;
    await file.download(...args);

    file.clear();

    expect(file.download).not.toHaveBeenCalled();
    await expect(file.download(...args)).resolves.toMatchObject({ data: new Uint8Array() });
  });

  test("resets typed workflow mocks to their unconfigured behavior", async () => {
    using wf = mockWorkflow();
    const job = wf.job(lookupCustomer);
    job.mockResolvedValue({ customerId: "c-1", source: "mock" });

    wf.reset();

    expect(() => lookupCustomer.start({ customerId: "c-1" })).toThrow(/No workflow job mock for/);
  });

  test("resets IdP and File mocks to their fallback behavior", async () => {
    using idp = mockIdp();
    const namespace = idp.namespace("customer-idp");
    namespace.user.mockResolvedValue({
      id: "u-1",
      name: "alice",
      disabled: false,
      mfaEnrolled: false,
      mfaFactorIds: [],
    });

    using file = mockFile();
    file.download.mockRejectedValue(new Error("configured failure"));

    idp.reset();
    file.reset();

    const client = new (globalThis as any).tailor.idp.Client({ namespace: "customer-idp" });
    await expect(client.user("u-1")).resolves.toMatchObject({ name: "mock-user" });
    await expect(
      file.download("main", "Document", "attachment", "record-1"),
    ).resolves.toMatchObject({ data: new Uint8Array() });
  });

  test("resets exposed client constructor implementations", async () => {
    using db = mockTailordb();
    db.Client.mockImplementation(function (this: any) {
      this.queryObject = vi.fn(async () => ({ rows: [{ id: "custom" }] }));
    });

    using idp = mockIdp();
    idp.Client.mockImplementation(function (this: any) {
      this.user = vi.fn(async () => ({ id: "custom", name: "custom" }));
    });

    db.reset();
    idp.reset();

    const dbClient = new (globalThis as any).tailordb.Client({});
    await expect(dbClient.queryObject("SELECT 1")).resolves.toMatchObject({ rows: [] });

    const idpClient = new (globalThis as any).tailor.idp.Client({ namespace: "customer-idp" });
    await expect(idpClient.user("u-1")).resolves.toMatchObject({ name: "mock-user" });
  });
});
