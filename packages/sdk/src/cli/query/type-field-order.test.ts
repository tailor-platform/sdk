import * as fs from "node:fs";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { loadTypeFieldOrder } from "./type-field-order";
import type { LoadedConfig } from "../shared/config-loader";

describe("loadTypeFieldOrder", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  function writeTypeFile(name: string, source: string): string {
    if (!tmpDir) {
      tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".type-order-")));
    }
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, source);
    return file;
  }

  test("loads field order from db.table builder outputs", async () => {
    const typeFile = writeTypeFile(
      "user.ts",
      `
import { db } from "@tailor-platform/sdk";
export const user = db.table("User", {
  firstName: db.string(),
  lastName: db.string(),
});
`,
    );
    const config = {
      path: "tailor.config.ts",
      name: "sample-app",
      db: {
        main: {
          files: [typeFile],
        },
      },
    } as LoadedConfig;

    await expect(loadTypeFieldOrder(config, "main")).resolves.toEqual(
      new Map([["User", ["id", "firstName", "lastName"]]]),
    );
  });
});
