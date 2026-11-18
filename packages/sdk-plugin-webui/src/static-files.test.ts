import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { serveStatic } from "./static-files";

let root: string;
let outside: string;

beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-webui-static-"));
  root = path.join(base, "client");
  outside = path.join(base, "secret.txt");
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "<html>shell</html>");
  fs.writeFileSync(path.join(root, "assets", "app.js"), "console.log(1)");
  fs.writeFileSync(outside, "secret");
});

afterEach(() => {
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

describe("serveStatic", () => {
  test("serves a file with its content type", async () => {
    const res = await serveStatic(root, "/assets/app.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
    expect(await res.text()).toBe("console.log(1)");
  });

  test("falls back to index.html for a client-side route without an extension", async () => {
    const res = await serveStatic(root, "/erd");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>shell</html>");
  });

  test("answers 404 for a missing file that has an extension", async () => {
    expect((await serveStatic(root, "/assets/missing.js")).status).toBe(404);
  });

  test.each(["/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt", "/%00"])(
    "never serves a file outside the directory (%s)",
    async (pathname) => {
      const res = await serveStatic(root, pathname);
      expect(await res.text()).not.toBe("secret");
    },
  );
});
