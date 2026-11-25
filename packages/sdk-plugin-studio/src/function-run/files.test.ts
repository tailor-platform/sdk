import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createSyncedFiles, type FileChange } from "./files";

let base: string;
let dir: string;

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "studio-files-")));
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(base, "case-"));
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

const collapseSpaces = async (code: string) =>
  code.includes("broken") ? undefined : code.replace(/\s+/g, " ").trim();

function setup(options: { starter?: string; starterArg?: string; existingCode?: string } = {}) {
  const file = path.join(dir, "studio", "function.ts");
  const argFile = path.join(dir, "studio", "function.arg.json5");
  const runArgFile = path.join(dir, "run", "arg.json");
  if (options.existingCode !== undefined) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, options.existingCode);
  }
  const files = createSyncedFiles({
    file,
    argFile,
    runArgFile,
    starter: options.starter,
    starterArg: options.starterArg,
    formatCode: collapseSpaces,
    pollMs: 0,
  });
  const changes: FileChange[] = [];
  files.subscribe((change) => changes.push(change));
  return { files, file, argFile, runArgFile, changes };
}

describe("init", () => {
  test("creates the function file from the starter and an empty argument file when they are missing", async () => {
    const { files, file, argFile, runArgFile } = setup({ starter: "export default 1;\n" });

    await files.init();

    expect([
      fs.readFileSync(file, "utf8"),
      fs.readFileSync(argFile, "utf8"),
      fs.readFileSync(runArgFile, "utf8"),
    ]).toEqual(["export default 1;\n", "", "{}"]);
  });

  test("creates the argument file from the starter argument, and hands the run its plain JSON", async () => {
    const { files, argFile, runArgFile } = setup({ starter: "x", starterArg: "{a: 1, b: 2}\n" });

    await files.init();

    expect([fs.readFileSync(argFile, "utf8"), fs.readFileSync(runArgFile, "utf8")]).toEqual([
      "{a: 1, b: 2}\n",
      '{"a":1,"b":2}',
    ]);
  });

  test("leaves an existing function file as it is", async () => {
    const { files, file } = setup({ starter: "starter", existingCode: "mine" });

    await files.init();

    expect([fs.readFileSync(file, "utf8"), files.read().code]).toEqual(["mine", "mine"]);
  });

  test("refuses to start when the function file is missing and there is no starter", async () => {
    const { files } = setup();

    await expect(files.init()).rejects.toThrow(/does not exist/);
  });
});

describe("write", () => {
  test("writes code that formats differently and leaves the file alone when it formats the same", async () => {
    const { files, file } = setup({ existingCode: "const a = 1;" });
    await files.init();

    await files.write({ code: "const   a =\n 1;" });
    const afterLayoutChange = fs.readFileSync(file, "utf8");
    await files.write({ code: "const a = 2;" });

    expect([afterLayoutChange, fs.readFileSync(file, "utf8")]).toEqual([
      "const a = 1;",
      "const a = 2;",
    ]);
  });

  test("writes code that cannot be formatted", async () => {
    const { files, file } = setup({ existingCode: "const a = 1;" });
    await files.init();

    await files.write({ code: "broken(" });

    expect(fs.readFileSync(file, "utf8")).toBe("broken(");
  });

  test("keeps the argument as typed and hands the run plain JSON", async () => {
    const { files, argFile, runArgFile } = setup({ starter: "x" });
    await files.init();

    await files.write({ arg: "{a: 1, // one\n b: 'two'}" });

    expect([fs.readFileSync(argFile, "utf8"), fs.readFileSync(runArgFile, "utf8")]).toEqual([
      "{a: 1, // one\n b: 'two'}",
      '{"a":1,"b":"two"}',
    ]);
  });

  test("does not rewrite the run's argument when the new text reads the same", async () => {
    const { files, argFile, runArgFile } = setup({ starter: "x" });
    await files.init();
    await files.write({ arg: "{a: 1}" });
    fs.writeFileSync(runArgFile, "sentinel");

    await files.write({ arg: '{"a": 1, /* same */}' });

    expect([fs.readFileSync(argFile, "utf8"), fs.readFileSync(runArgFile, "utf8")]).toEqual([
      '{"a": 1, /* same */}',
      "sentinel",
    ]);
  });

  test("writes {} for an empty argument", async () => {
    const { files, runArgFile } = setup({ starter: "x" });
    await files.init();
    await files.write({ arg: "{a: 1}" });

    await files.write({ arg: "" });

    expect(fs.readFileSync(runArgFile, "utf8")).toBe("{}");
  });

  test("rejects an argument that does not parse and touches nothing", async () => {
    const { files, argFile, runArgFile } = setup({ starter: "x" });
    await files.init();
    await files.write({ arg: "{a: 1}" });

    const result = await files.write({ arg: "{oops" });

    expect([
      result.argError === undefined,
      fs.readFileSync(argFile, "utf8"),
      fs.readFileSync(runArgFile, "utf8"),
    ]).toEqual([false, "{a: 1}", '{"a":1}']);
  });
});

describe("when an edit happened", () => {
  function setupWithClock() {
    const edits: number[] = [];
    const file = path.join(dir, "studio", "function.ts");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "const a = 1;");
    const files = createSyncedFiles({
      file,
      argFile: path.join(dir, "studio", "function.arg.json5"),
      runArgFile: path.join(dir, "run", "arg.json"),
      formatCode: collapseSpaces,
      pollMs: 300,
      onInputsChanged: (at) => edits.push(at),
    });
    return { files, file, edits };
  }

  test("is the time the file was saved for an edit that is only seen later", async () => {
    const { files, file, edits } = setupWithClock();
    await files.init();
    edits.length = 0;
    fs.writeFileSync(file, "const a = 2;");
    const saved = Date.now() - 200;
    fs.utimesSync(file, saved / 1000, saved / 1000);

    await files.refresh();

    expect(Math.abs(edits[0]! - saved)).toBeLessThan(5);
  });

  test("is the time the run's copy of the argument was written, since that is the file the watch sees", async () => {
    const { files, edits } = setupWithClock();
    await files.init();
    edits.length = 0;
    const argFile = path.join(dir, "studio", "function.arg.json5");
    fs.writeFileSync(argFile, "{a: 2}");
    const saved = Date.now() - 200;
    fs.utimesSync(argFile, saved / 1000, saved / 1000);
    const before = Date.now();

    await files.refresh();

    expect(edits[0]).toBeGreaterThanOrEqual(before);
  });

  test("is not taken from a file time older than a poll, which would hide a run that is on its way", async () => {
    const { files, file, edits } = setupWithClock();
    await files.init();
    edits.length = 0;
    fs.writeFileSync(file, "const a = 2;");
    const old = Date.now() - 60_000;
    fs.utimesSync(file, old / 1000, old / 1000);
    const before = Date.now();

    await files.refresh();

    expect(edits[0]).toBeGreaterThanOrEqual(before - 400);
  });

  test("is the time of the write for what a page wrote", async () => {
    const { files, edits } = setupWithClock();
    await files.init();
    edits.length = 0;
    const before = Date.now();

    await files.write({ code: "const a = 3;" });

    expect(edits[0]).toBeGreaterThanOrEqual(before);
  });
});

describe("write announcements", () => {
  test("tells the other pages what a page wrote, with the origin that sent it", async () => {
    const { files, changes } = setup({ existingCode: "const a = 1;" });
    await files.init();

    await files.write({ code: "const a = 2;", arg: "{a: 1}", origin: "page-1" });

    expect(changes).toEqual([
      { code: "const a = 2;", origin: "page-1" },
      { arg: "{a: 1}", origin: "page-1" },
    ]);
  });

  test("announces nothing for text that formats the same as what is there", async () => {
    const { files, changes } = setup({ existingCode: "const a = 1;" });
    await files.init();

    await files.write({ code: "const   a =\n 1;", origin: "page-1" });

    expect(changes).toEqual([]);
  });
});

describe("refresh", () => {
  test("announces a change made to the function file from outside", async () => {
    const { files, file, changes } = setup({ starter: "x" });
    await files.init();

    fs.writeFileSync(file, "edited by someone else");
    await files.refresh();

    expect([changes, files.read().code]).toEqual([
      [{ code: "edited by someone else" }],
      "edited by someone else",
    ]);
  });

  test("sees a file that is replaced by renaming another over it", async () => {
    const { files, file, changes } = setup({ starter: "x" });
    await files.init();

    fs.writeFileSync(`${file}.tmp`, "saved atomically");
    fs.renameSync(`${file}.tmp`, file);
    await files.refresh();

    expect(changes).toEqual([{ code: "saved atomically" }]);
  });

  test("does not announce a page's own write a second time when it looks for changes", async () => {
    const { files, changes } = setup({ starter: "x" });
    await files.init();

    await files.write({ code: "typed in the page", arg: "{a: 1}" });
    changes.length = 0;
    await files.refresh();

    expect(changes).toEqual([]);
  });

  test("announces an argument changed from outside and hands the run plain JSON", async () => {
    const { files, argFile, runArgFile, changes } = setup({ starter: "x" });
    await files.init();

    fs.writeFileSync(argFile, "{b: 2,}");
    await files.refresh();

    expect([changes, fs.readFileSync(runArgFile, "utf8")]).toEqual([
      [{ arg: "{b: 2,}" }],
      '{"b":2}',
    ]);
  });

  test("keeps the run's last valid argument when the argument is edited into invalid text, and says so", async () => {
    const { files, argFile, runArgFile } = setup({ starter: "x" });
    await files.init();
    fs.writeFileSync(argFile, "{b: 2}");
    await files.refresh();

    fs.writeFileSync(argFile, "{b: ");
    await files.refresh();
    const whileInvalid = [
      fs.readFileSync(runArgFile, "utf8"),
      files.status().argError === undefined,
    ];
    fs.writeFileSync(argFile, "{b: 3}");
    await files.refresh();

    expect([whileInvalid, files.status().argError]).toEqual([['{"b":2}', false], undefined]);
  });

  test("does not announce a change when nothing changed", async () => {
    const { files, changes } = setup({ starter: "x" });
    await files.init();

    await files.refresh();

    expect(changes).toEqual([]);
  });
});

describe("status", () => {
  test("moves changedAt forward when the function or the argument changes", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1000);
      const { files, file } = setup({ starter: "x" });
      await files.init();
      const first = files.status().changedAt;

      vi.setSystemTime(2000);
      fs.writeFileSync(file, "changed");
      await files.refresh();

      expect([first, files.status().changedAt]).toEqual([1000, 2000]);
    } finally {
      vi.useRealTimers();
    }
  });
});
