import * as fs from "node:fs";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { silenceLogger } from "@/cli/shared/test-helpers/silence-logger";
import { createTailorDBService } from "./service";

describe("createTailorDBService.loadTypes", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  function writeTypeFile(name: string, source: string): string {
    if (!tmpDir) {
      tmpDir = fs.realpathSync(
        fs.mkdtempSync(path.join(import.meta.dirname, ".tailordb-service-")),
      );
    }
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, source);
    return file;
  }

  test("rejects duplicate type names loaded from multiple files in one namespace", async () => {
    const userFile = writeTypeFile(
      "user.ts",
      `
import { db } from "@tailor-platform/sdk";
export const user = db.type("User", {
  name: db.string(),
});
`,
    );
    const accountFile = writeTypeFile(
      "account.ts",
      `
import { db } from "@tailor-platform/sdk";
export const account = db.type("User", {
  email: db.string(),
});
`,
    );

    const service = createTailorDBService({
      namespace: "main",
      config: { files: [userFile, accountFile] },
    });

    using _logger = silenceLogger("error", "log");
    await expect(service.loadTypes()).rejects.toThrow(
      /Duplicate TailorDB type name "User" detected in TailorDB service "main"/,
    );
  });

  test("allows type names that match Object prototype properties", async () => {
    const typeFile = writeTypeFile(
      "object-prototype.ts",
      `
import { db } from "@tailor-platform/sdk";
export const objectPrototype = db.type("toString", {
  value: db.string(),
});
`,
    );

    const service = createTailorDBService({
      namespace: "main",
      config: { files: [typeFile] },
    });

    const types = await service.loadTypes();
    expect(Object.hasOwn(types ?? {}, "toString")).toBe(true);
  });
});
