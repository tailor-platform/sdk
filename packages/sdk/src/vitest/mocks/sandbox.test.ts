/**
 * Tests for the in-memory `mockSandbox` (`tailor.sandbox`).
 */
import { aroundEach, describe, expect, test } from "vitest";
import { injectMocks, mockSandbox } from "#/vitest/mock";

const sandboxApi = () => globalThis.tailor.sandbox;

describe("mockSandbox", () => {
  aroundEach(async (runTest) => {
    using _mocks = injectMocks(globalThis);
    await runTest();
  });

  test("restores the previous tailor.sandbox on dispose", () => {
    const before = globalThis.tailor.sandbox;
    {
      using _sb = mockSandbox();
      expect(globalThis.tailor.sandbox).not.toBe(before);
    }
    expect(globalThis.tailor.sandbox).toBe(before);
  });

  describe("lifecycle", () => {
    test("create returns an ephemeral RUNNING sandbox with ISO timestamps", async () => {
      using _sb = mockSandbox();

      const box = await sandboxApi().create({ template: "guest" });

      expect(box).toMatchObject({ template: "guest", status: "RUNNING", kept: false });
      expect(box.name).toBeUndefined();
      expect(box.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:]+\.\d{3}Z$/);
    });

    test("create with a name is kept and findable by name and id", async () => {
      using sb = mockSandbox();

      const box = await sandboxApi().create({ template: "guest", name: "dev" });

      expect(box.kept).toBe(true);
      await expect(sandboxApi().getByName("dev")).resolves.toBe(box);
      await expect(sandboxApi().get(box.id)).resolves.toBe(box);
      expect(sb.sandboxes).toEqual([box]);
    });

    test("create raises ALREADY_EXISTS for a live name", async () => {
      using _sb = mockSandbox();
      await sandboxApi().create({ template: "guest", name: "dev" });

      await expect(sandboxApi().create({ template: "guest", name: "dev" })).rejects.toMatchObject({
        name: "SandboxError",
        code: "ALREADY_EXISTS",
      });
    });

    test("create rejects a missing template with INVALID_ARGUMENT", async () => {
      using _sb = mockSandbox();

      await expect(
        sandboxApi().create({} as unknown as { template: string }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });

    test("get and getByName raise NOT_FOUND for unknown sandboxes", async () => {
      using _sb = mockSandbox();

      await expect(sandboxApi().get("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(sandboxApi().getByName("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    test("getOrCreate creates once and then returns the same sandbox", async () => {
      using _sb = mockSandbox();

      const first = await sandboxApi().getOrCreate({ name: "dev", template: "guest" });
      const second = await sandboxApi().getOrCreate({ name: "dev", template: "guest" });

      expect(second).toBe(first);
    });

    test("getOrCreate without a name raises INVALID_ARGUMENT", async () => {
      using _sb = mockSandbox();

      await expect(
        sandboxApi().getOrCreate({ template: "guest" } as unknown as {
          name: string;
          template: string;
        }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });

    test("destroying a destroyed sandbox is a no-op success", async () => {
      using _sb = mockSandbox();
      const box = await sandboxApi().create({ template: "guest" });
      await box.destroy();

      await expect(box.destroy()).resolves.toBeUndefined();
      expect(box.status).toBe("DESTROYED");
    });

    test("destroy marks DESTROYED, frees the name and blocks further commands", async () => {
      using _sb = mockSandbox();
      const box = await sandboxApi().create({ template: "guest", name: "dev" });

      await box.destroy();

      expect(box.status).toBe("DESTROYED");
      await expect(sandboxApi().getByName("dev")).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(box.exec(["true"])).rejects.toMatchObject({ code: "FAILED_PRECONDITION" });
      const reused = await sandboxApi().create({ template: "guest", name: "dev" });
      expect(reused.id).not.toBe(box.id);
    });
  });

  describe("exec", () => {
    test("defaults to exit code 0 with empty output", async () => {
      using _sb = mockSandbox();
      const box = await sandboxApi().create({ template: "guest" });

      const result = await box.exec(["true"]);

      expect(result).toMatchObject({
        status: "SUCCESS",
        exitCode: 0,
        stdout: "",
        stderr: "",
        outputTruncated: false,
        sandboxId: box.id,
      });
    });

    test("runs the onExec handler and maps a non-zero exit to FAILED without throwing", async () => {
      using sb = mockSandbox();
      sb.onExec((argv, opts) => ({
        stdout: `${argv.join(" ")}@${opts?.cwd}`,
        stderr: "oops",
        exitCode: 2,
      }));
      const box = await sandboxApi().create({ template: "guest" });

      const result = await box.exec(["ls", "-l"], { cwd: "/workspace/app" });

      expect(result).toMatchObject({
        status: "FAILED",
        exitCode: 2,
        stdout: "ls -l@/workspace/app",
        stderr: "oops",
      });
      expect(new TextDecoder().decode(result.stdoutBytes)).toBe("ls -l@/workspace/app");
      expect(result.finishedAt).toBeDefined();
    });

    test("supports an async handler and byte output", async () => {
      using sb = mockSandbox();
      sb.onExec(async () => ({ stdout: new Uint8Array([104, 105]) }));
      const box = await sandboxApi().create({ template: "guest" });

      const result = await box.exec(["x"]);

      expect(result.stdout).toBe("hi");
    });

    test("rejects an empty argv with INVALID_ARGUMENT", async () => {
      using _sb = mockSandbox();
      const box = await sandboxApi().create({ template: "guest" });

      await expect(box.exec([])).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });

    test("records every run in order", async () => {
      using sb = mockSandbox();
      const box = await sandboxApi().create({ template: "guest" });

      await box.exec(["a"]);
      await box.start(["b"], { env: { K: "V" } });

      expect(sb.executions.map((e) => e.argv)).toEqual([["a"], ["b"]]);
      expect(sb.executions[1]).toMatchObject({ sandboxId: box.id, opts: { env: { K: "V" } } });
    });

    test("an idempotencyKey returns the same execution without running again", async () => {
      using sb = mockSandbox();
      const box = await sandboxApi().create({ template: "guest" });

      const first = await box.start(["a"], { idempotencyKey: "k" });
      const second = await box.start(["a"], { idempotencyKey: "k" });

      expect(second.id).toBe(first.id);
      expect(sb.executions).toHaveLength(1);
    });
  });

  describe("executions", () => {
    test("start returns a finished execution whose output streams chunks and an exit chunk", async () => {
      using sb = mockSandbox();
      sb.onExec(() => ({ stdout: "out", stderr: "err", exitCode: 0 }));
      const box = await sandboxApi().create({ template: "guest" });

      const exec = await box.start(["x"]);
      const chunks = [];
      for await (const chunk of exec.output()) chunks.push(chunk);

      expect(chunks.map((c) => c.type)).toEqual(["stdout", "stderr", "exit"]);
      expect(chunks[0]).toMatchObject({ type: "stdout", offset: 0 });
      expect(new TextDecoder().decode((chunks[0] as { data: Uint8Array }).data)).toBe("out");
      expect(chunks[2]).toMatchObject({ type: "exit", execution: { status: "SUCCESS" } });
    });

    test("output resumes from the given offsets", async () => {
      using sb = mockSandbox();
      sb.onExec(() => ({ stdout: "abcdef" }));
      const box = await sandboxApi().create({ template: "guest" });
      const exec = await box.start(["x"]);

      const chunks = [];
      for await (const chunk of exec.output({ stdoutOffset: 4 })) chunks.push(chunk);

      expect(chunks[0]).toMatchObject({ type: "stdout", offset: 4 });
      expect(new TextDecoder().decode((chunks[0] as { data: Uint8Array }).data)).toBe("ef");
    });

    test("execution(id), wait and refresh find the same execution; unknown id is NOT_FOUND", async () => {
      using _sb = mockSandbox();
      const box = await sandboxApi().create({ template: "guest" });
      const exec = await box.start(["x"]);

      expect((await box.execution(exec.id)).id).toBe(exec.id);
      expect((await exec.wait()).status).toBe("SUCCESS");
      expect((await exec.refresh()).id).toBe(exec.id);
      await expect(box.execution("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    test("executions filters by status and pages with a token", async () => {
      using sb = mockSandbox();
      sb.onExec((argv) => ({ exitCode: argv[0] === "bad" ? 1 : 0 }));
      const box = await sandboxApi().create({ template: "guest" });
      await box.exec(["ok1"]);
      await box.exec(["bad"]);
      await box.exec(["ok2"]);

      const failed = await box.executions({ status: "FAILED" });
      expect(failed.executions).toHaveLength(1);
      expect(failed.nextPageToken).toBe("");

      const page1 = await box.executions({ pageSize: 2 });
      expect(page1.executions).toHaveLength(2);
      expect(page1.nextPageToken).not.toBe("");
      const page2 = await box.executions({ pageSize: 2, pageToken: page1.nextPageToken });
      expect(page2.executions).toHaveLength(1);
      expect(page2.nextPageToken).toBe("");
    });

    test("cancel on a finished execution leaves its status unchanged", async () => {
      using _sb = mockSandbox();
      const box = await sandboxApi().create({ template: "guest" });
      const exec = await box.start(["x"]);

      expect((await exec.cancel()).status).toBe("SUCCESS");
    });
  });

  describe("files", () => {
    test("writeFile then readFile round-trips bytes and decoded text", async () => {
      using sb = mockSandbox();
      const box = await sandboxApi().create({ template: "guest" });

      await expect(box.writeFile("/workspace/a.txt", "héllo")).resolves.toEqual({
        bytesWritten: 6,
      });

      expect(await box.readFile("/workspace/a.txt", { encoding: "utf-8" })).toBe("héllo");
      expect(await box.readFile("/workspace/a.txt")).toEqual(new TextEncoder().encode("héllo"));
      expect([...sb.files(box.id).keys()]).toEqual(["/workspace/a.txt"]);
    });

    test("writeFile accepts Uint8Array, ArrayBuffer and ReadableStream", async () => {
      using _sb = mockSandbox();
      const box = await sandboxApi().create({ template: "guest" });
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array([1, 2]));
          c.enqueue(new Uint8Array([3]));
          c.close();
        },
      });

      await box.writeFile("/workspace/u8", new Uint8Array([9]));
      await box.writeFile("/workspace/ab", new Uint8Array([7, 8]).buffer);
      const streamed = await box.writeFile("/workspace/s", stream);

      expect(streamed).toEqual({ bytesWritten: 3 });
      expect(await box.readFile("/workspace/u8")).toEqual(new Uint8Array([9]));
      expect(await box.readFile("/workspace/ab")).toEqual(new Uint8Array([7, 8]));
      expect(await box.readFile("/workspace/s")).toEqual(new Uint8Array([1, 2, 3]));
    });

    test("readFileStream streams the file bytes", async () => {
      using _sb = mockSandbox();
      const box = await sandboxApi().create({ template: "guest" });
      await box.writeFile("/workspace/a", "abc");

      const reader = box.readFileStream("/workspace/a").getReader();
      const { value } = await reader.read();

      expect(new TextDecoder().decode(value)).toBe("abc");
    });

    test("listFiles shows files and synthesized directories, sorted", async () => {
      using _sb = mockSandbox();
      const box = await sandboxApi().create({ template: "guest" });
      await box.writeFile("/workspace/z.txt", "zz");
      await box.writeFile("/workspace/src/a.ts", "a");
      await box.writeFile("/workspace/src/b.ts", "b");

      const root = await box.listFiles("/workspace");
      expect(root.map(({ name, size, isDir }) => ({ name, size, isDir }))).toEqual([
        { name: "src", size: 0, isDir: true },
        { name: "z.txt", size: 2, isDir: false },
      ]);
      expect((await box.listFiles("/workspace/src")).map((f) => f.name)).toEqual(["a.ts", "b.ts"]);
    });

    test("deleteFile removes the file; a second delete or a read is NOT_FOUND", async () => {
      using _sb = mockSandbox();
      const box = await sandboxApi().create({ template: "guest" });
      await box.writeFile("/workspace/a", "x");

      await box.deleteFile("/workspace/a");

      await expect(box.readFile("/workspace/a")).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(box.deleteFile("/workspace/a")).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    test.each([
      ["/etc/passwd"],
      ["relative.txt"],
      ["/workspace/../etc/passwd"],
      ["/workspacex/a"],
      ["/"],
    ])("rejects %s with INVALID_ARGUMENT", async (path) => {
      using _sb = mockSandbox();
      const box = await sandboxApi().create({ template: "guest" });

      await expect(box.writeFile(path, "x")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      await expect(box.readFile(path)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      await expect(box.listFiles(path)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      await expect(box.deleteFile(path)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      expect(() => box.readFileStream(path)).toThrow(
        expect.objectContaining({ code: "INVALID_ARGUMENT" }),
      );
    });

    test("normalizes dot segments that stay inside /workspace", async () => {
      using sb = mockSandbox();
      const box = await sandboxApi().create({ template: "guest" });

      await box.writeFile("/workspace/a/../b.txt", "x");

      expect([...sb.files(box.id).keys()]).toEqual(["/workspace/b.txt"]);
    });
  });

  describe("reset and clear", () => {
    test("clear drops recordings but keeps sandboxes; reset drops everything", async () => {
      using sb = mockSandbox();
      const box = await sandboxApi().create({ template: "guest" });
      await box.exec(["a"]);

      sb.clear();
      expect(sb.executions).toEqual([]);
      expect(sb.sandboxes).toHaveLength(1);
      expect(sb.create).not.toHaveBeenCalled();

      sb.reset();
      expect(sb.sandboxes).toEqual([]);
    });

    test("nested scopes are isolated and the outer scope is restored", async () => {
      using outer = mockSandbox();
      await sandboxApi().create({ template: "guest" });
      {
        using inner = mockSandbox();
        await sandboxApi().create({ template: "guest" });
        expect(inner.sandboxes).toHaveLength(1);
      }
      await sandboxApi().create({ template: "guest" });
      expect(outer.sandboxes).toHaveLength(2);
    });
  });
});
