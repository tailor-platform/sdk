import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ensureConfigId } from "./config-id-injector";

describe("ensureConfigId", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "config-id-injector-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  async function writeConfig(source: string): Promise<string> {
    const filePath = path.join(tempDir, "tailor.config.ts");
    await fs.promises.writeFile(filePath, source, "utf-8");
    return filePath;
  }

  test("injects an id into defineConfig with no existing id", async () => {
    const filePath = await writeConfig(
      `import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "my-app",
});
`,
    );

    const result = await ensureConfigId(filePath);

    expect(result).not.toBeNull();
    expect(result?.injected).toBe(true);
    expect(result?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const updated = await fs.promises.readFile(filePath, "utf-8");
    expect(updated).toContain(`id: "${result?.id}"`);
    expect(updated).toContain(`name: "my-app"`);
    expect(updated).toContain(
      "// SDK-managed app id — do not edit, except when copying this config to a separate app.",
    );
  });

  test("returns the existing id when already present", async () => {
    const existingId = "c98794dd-9bf1-480f-a5c9-bf92b3679d42";
    const filePath = await writeConfig(
      `import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  id: "${existingId}",
  name: "my-app",
});
`,
    );

    const before = await fs.promises.readFile(filePath, "utf-8");
    const result = await ensureConfigId(filePath);

    expect(result).toEqual({ id: existingId, injected: false });
    const after = await fs.promises.readFile(filePath, "utf-8");
    expect(after).toBe(before);
  });

  test("returns null when defineConfig is not present (wrapper file)", async () => {
    const filePath = await writeConfig(
      `export { default } from "./other.config";
`,
    );

    const result = await ensureConfigId(filePath);
    expect(result).toBeNull();
  });

  test("throws when id is not a string literal", async () => {
    const filePath = await writeConfig(
      `import { defineConfig } from "@tailor-platform/sdk";

const id = "computed";
export default defineConfig({
  id,
  name: "my-app",
});
`,
    );

    await expect(ensureConfigId(filePath)).rejects.toThrow(/string literal/);
  });

  test("throws when id is an empty string", async () => {
    const filePath = await writeConfig(
      `import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  id: "",
  name: "my-app",
});
`,
    );

    await expect(ensureConfigId(filePath)).rejects.toThrow(/non-empty string literal/);
  });

  test("throws when id is not a UUID", async () => {
    const filePath = await writeConfig(
      `import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  id: "not-a-uuid",
  name: "my-app",
});
`,
    );

    await expect(ensureConfigId(filePath)).rejects.toThrow(/UUID/);
  });

  test("throws when defineConfig is called more than once", async () => {
    const filePath = await writeConfig(
      `import { defineConfig } from "@tailor-platform/sdk";

defineConfig({ name: "first" });
export default defineConfig({ name: "second" });
`,
    );

    await expect(ensureConfigId(filePath)).rejects.toThrow(/Multiple defineConfig/);
  });

  test("throws when defineConfig argument is not an object literal", async () => {
    const filePath = await writeConfig(
      `import { defineConfig } from "@tailor-platform/sdk";

const config = { name: "my-app" };
export default defineConfig(config);
`,
    );

    await expect(ensureConfigId(filePath)).rejects.toThrow(/inline object literal/);
  });

  test("inserts id at the top while preserving formatting", async () => {
    const filePath = await writeConfig(
      `import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "my-app",
  db: {
    main: { files: ["./tailordb/*.ts"] },
  },
});
`,
    );

    const result = await ensureConfigId(filePath);
    expect(result).not.toBeNull();

    const updated = await fs.promises.readFile(filePath, "utf-8");
    const lines = updated.split("\n");
    const idLineIndex = lines.findIndex((line) => line.includes("id:"));
    const nameLineIndex = lines.findIndex((line) => line.includes("name:"));
    expect(idLineIndex).toBeGreaterThan(-1);
    expect(nameLineIndex).toBeGreaterThan(idLineIndex);
  });
});
