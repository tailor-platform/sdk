import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

type Scripts = Record<string, string>;

const packageJson = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
) as { packageManager: string; scripts: Scripts };

const expectedCoordinator = 'pnpm run --no-bail "/^check-type:/"';
const expectedChecks = {
  "check-type:example": "pnpm --filter example run typecheck:generated",
  "check-type:native-preview": "pnpm --no-bail -r run typecheck:go",
  "check-type:stable": "pnpm --filter=!example --no-bail -r run typecheck",
} satisfies Scripts;
type Lane = keyof typeof expectedChecks extends `check-type:${infer Name}` ? Name : never;
const lanes = Object.keys(expectedChecks).map((name) => name.slice("check-type:".length)) as Lane[];

const invalidCases: Array<[string, (scripts: Scripts) => void]> = [
  [
    "stale serial coordinator",
    (scripts) => {
      scripts["check:typecheck"] = "pnpm -r run typecheck:go";
    },
  ],
  [
    "missing branch",
    (scripts) => {
      delete scripts["check-type:example"];
    },
  ],
  [
    "malformed branch",
    (scripts) => {
      scripts["check-type:stable"] = "tsc --noEmit";
    },
  ],
  [
    "out-of-scope helper",
    (scripts) => {
      scripts["check:typecheck:stable"] = expectedChecks["check-type:stable"];
    },
  ],
];

function validateParallelTypecheckScripts(scripts: Scripts): void {
  if (scripts["check:typecheck"] !== expectedCoordinator) {
    throw new Error("typecheck coordinator mismatch");
  }

  const checkNames = Object.keys(scripts)
    .filter((name) => name.startsWith("check-type:"))
    .toSorted();
  if (JSON.stringify(checkNames) !== JSON.stringify(Object.keys(expectedChecks).toSorted())) {
    throw new Error("typecheck branch set mismatch");
  }
  for (const [name, command] of Object.entries(expectedChecks)) {
    if (scripts[name] !== command) throw new Error(`typecheck command mismatch: ${name}`);
  }

  if (Object.keys(scripts).some((name) => name.startsWith("check:typecheck:"))) {
    throw new Error("typecheck helper namespace mismatch");
  }
}

describe("workspace typecheck scripts", () => {
  test("fan out independent checks without masking failures", () => {
    expect(validateParallelTypecheckScripts(packageJson.scripts)).toBeUndefined();
  });

  test.each(invalidCases)("rejects %s", (_, mutate) => {
    const scripts = { ...packageJson.scripts };
    mutate(scripts);

    expect(() => validateParallelTypecheckScripts(scripts)).toThrow(/typecheck .* mismatch/);
  });

  test.each(lanes)("reports every branch when %s fails", (failedLane) => {
    const fixture = mkdtempSync(join(tmpdir(), "typecheck-fanout-"));
    const scripts: Scripts = {
      "check:typecheck": expectedCoordinator,
    };
    for (const [index, lane] of lanes.entries()) {
      const outcome = lane === failedLane ? "failed" : "finished";
      const logger = lane === failedLane ? "error" : "log";
      const exitCode = lane === failedLane ? index + 1 : 0;
      scripts[`check-type:${lane}`] =
        `node -e "setTimeout(function () { console.${logger}(['sentinel-${lane}', '${outcome}'].join(' ')); process.exitCode = ${exitCode} }, ${(index + 1) * 100})"`;
    }

    try {
      writeFileSync(
        join(fixture, "package.json"),
        JSON.stringify({ packageManager: packageJson.packageManager, private: true, scripts }),
      );
      const pnpm =
        process.platform === "win32"
          ? {
              command: process.env.ComSpec ?? "cmd.exe",
              args: ["/d", "/s", "/c", "pnpm run check:typecheck"],
            }
          : { command: "pnpm", args: ["run", "check:typecheck"] };
      const result = spawnSync(pnpm.command, pnpm.args, { cwd: fixture, encoding: "utf8" });
      const output = `${result.stdout}${result.stderr}`;

      expect(result.status).not.toBe(0);
      for (const lane of lanes) {
        const outcome = lane === failedLane ? "failed" : "finished";
        expect(output).toContain(`sentinel-${lane} ${outcome}`);
      }
    } finally {
      rmSync(fixture, { force: true, recursive: true });
    }
  });
});
