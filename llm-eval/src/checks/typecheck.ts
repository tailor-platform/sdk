import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import type { Signal } from "../types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolvePath(__dirname, "../..");

const TSGO_BIN = (() => {
  const candidates = [
    resolvePath(PKG_ROOT, "node_modules/.bin/tsgo"),
    resolvePath(PKG_ROOT, "../node_modules/.bin/tsgo"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`tsgo not found in: ${candidates.join(", ")}`);
})();

/**
 * Type-check the generated code against the variant SDK using `tsgo`
 * (TypeScript native preview) as a subprocess. ~3-4× faster per cell than
 * spinning up ts-morph in-process.
 *
 * The snippet is written to `llm-eval/.tmp/<id>.ts` so that import resolution
 * walks up to the workspace `node_modules` and picks up `@tailor-platform/sdk`.
 * `variantDist` is currently informational — Phase 2 will swap dist via paths.
 */
export async function typecheckCode(
  code: string,
  cellId: string,
  variantDist: string,
): Promise<Signal[]> {
  void variantDist;

  const tmpDir = join(PKG_ROOT, ".tmp");
  await mkdir(tmpDir, { recursive: true });
  const safeName = cellId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = join(tmpDir, `${safeName}.ts`);
  await writeFile(filePath, code, "utf8");

  const args = [
    "--noEmit",
    "--ignoreConfig",
    "--skipLibCheck",
    "--target",
    "ESNext",
    "--module",
    "ESNext",
    "--moduleResolution",
    "Bundler",
    "--strict",
    "--esModuleInterop",
    filePath,
  ];

  const { stdout } = await runTsgo(TSGO_BIN, args);
  const { codes, messages } = parseDiagnostics(stdout);
  if (codes.length === 0) return [];
  return [{ type: "typecheck_failure", tsCodes: codes, messages }];
}

function runTsgo(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", () => resolve({ stdout, stderr }));
  });
}

const DIAG_RE = /^(.+?)\((\d+),(\d+)\): error TS(\d+): (.*)$/;

function parseDiagnostics(out: string): { codes: string[]; messages: string[] } {
  const codes: string[] = [];
  const messages: string[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = DIAG_RE.exec(line);
    if (!m) continue;
    codes.push(`TS${m[4]}`);
    messages.push(m[5]);
  }
  return { codes, messages };
}
