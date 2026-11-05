import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { EVALUATE_FLAG, evaluateInFreshProcess } from "./evaluate-process";

const mapperEntry = fileURLToPath(
  new URL("../../../dist/cli/content-mapper/mapper-main.mjs", import.meta.url),
);
const TIMEOUT_MS = 60_000;
const HANGING_CONFIG = `import "./helper";\nsetInterval(() => {}, 1000);\nawait new Promise(() => {});\n`;

const projects: string[] = [];

afterEach(() => {
  for (const dir of projects.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function projectWith(config: string, helper: string): { configPath: string; helperPath: string } {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(import.meta.dirname, ".sdk-evaluate-process-")),
  );
  projects.push(dir);
  fs.writeFileSync(path.join(dir, "tsconfig.json"), "{}");
  fs.writeFileSync(path.join(dir, "tailor.config.ts"), config);
  fs.writeFileSync(path.join(dir, "helper.ts"), helper);
  return {
    configPath: path.join(dir, "tailor.config.ts"),
    helperPath: path.join(dir, "helper.ts"),
  };
}

describe("evaluateInFreshProcess", () => {
  test(
    "keeps the files the config had imported when a helper exits the process",
    async () => {
      const { configPath, helperPath } = projectWith(
        `import "./helper";\nexport default {};\n`,
        `process.exit(1);\n`,
      );

      const evaluation = await evaluateInFreshProcess(mapperEntry)(configPath);

      expect(evaluation.error).toContain("exited with code 1");
      expect(evaluation.files).toEqual(expect.arrayContaining([configPath, helperPath]));
    },
    TIMEOUT_MS,
  );

  test(
    "stops a config that never finishes and keeps the files it had imported",
    async () => {
      const { configPath, helperPath } = projectWith(HANGING_CONFIG, `export {};\n`);

      const evaluation = await evaluateInFreshProcess(mapperEntry, 20_000)(configPath);

      expect(evaluation.error).toContain("did not finish within 20 seconds");
      expect(evaluation.files).toEqual(expect.arrayContaining([configPath, helperPath]));
    },
    TIMEOUT_MS,
  );

  test(
    "exits when the process that started it goes away",
    async () => {
      const { configPath } = projectWith(HANGING_CONFIG, `export {};\n`);
      const child = spawn(process.execPath, [mapperEntry, EVALUATE_FLAG, configPath], {
        stdio: ["pipe", "ignore", "ignore"],
      });
      const exited = new Promise<void>((resolve) => child.on("exit", () => resolve()));
      await new Promise((resolve) => setTimeout(resolve, 3000));

      child.stdin.end();

      await expect(exited).resolves.toBeUndefined();
    },
    TIMEOUT_MS,
  );
});
