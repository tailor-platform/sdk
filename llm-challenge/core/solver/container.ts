import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getPinnedPackageManager } from "../../shared/helpers";

const challengeRoot = path.resolve(import.meta.dirname, "..", "..");

/**
 * Image tag derived from the Containerfile content hash so that any edit to
 * `getContainerfileContent()` (e.g. pnpm pin bumps) forces a rebuild on the
 * next run without manual cleanup. The fallback `latest` tag stays alive for
 * older clones that don't compute the hash, but it is never read directly.
 */
function getImageName(): string {
  const hash = crypto
    .createHash("sha256")
    .update(getContainerfileContent())
    .digest("hex")
    .slice(0, 12);
  return `llm-challenge-runner:${hash}`;
}

/**
 * Fixed working directory inside the container.
 *
 * Host workDir (e.g. /var/folders/.../sdk-ws-xxx) is mounted here to avoid
 * macOS-specific paths leaking into the container.
 */
export const CONTAINER_WORK_DIR = "/workspace";

/**
 * Where the host's `~/.codex/auth.json` is mounted inside the container.
 * `CODEX_HOME` is set to the parent so codex does not look elsewhere on the
 * host filesystem (which is not mounted anyway).
 */
export const CONTAINER_CODEX_HOME = "/home/node/.codex";
export const CONTAINER_CODEX_AUTH = `${CONTAINER_CODEX_HOME}/auth.json`;

type PodmanStatus = {
  available: boolean;
  error?: string;
};

export function checkPodmanAvailability(): PodmanStatus {
  try {
    execFileSync("podman", ["--version"], { stdio: "pipe", timeout: 10_000 });
  } catch {
    return {
      available: false,
      error: "podman is not installed. Install it from https://podman.io/",
    };
  }

  // On macOS, the Podman machine VM must be running
  if (process.platform === "darwin") {
    try {
      execFileSync("podman", ["info"], { stdio: "pipe", timeout: 30_000 });
    } catch {
      return {
        available: false,
        error: 'Podman machine is not running. Run "podman machine start" first.',
      };
    }
  }

  return { available: true };
}

export function getContainerfileContent(): string {
  // Pin the container's pnpm to whatever the monorepo declares in its
  // `packageManager` field. The host runs `pnpm install` with this exact
  // version before mounting the workDir, and the workDir's package.json
  // carries the same `packageManager` spec, so the agent's in-container
  // `pnpm <cmd>` calls never (a) corepack-download a new "latest" mid-solve
  // or (b) recreate `node_modules` because the recorded pnpm version differs
  // from the one that produced it. Falls back to `latest` only when the
  // monorepo somehow lacks a pinned spec (shouldn't happen).
  const pnpmSpec = getPinnedPackageManager(challengeRoot) ?? "pnpm@latest";
  return [
    "FROM node:22-slim",
    "RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*",
    "RUN corepack enable",
    "RUN npm install -g @openai/codex",
    // Pre-create the writable CODEX_HOME slot before switching to non-root user.
    // The host's auth.json is bind-mounted read-only at runtime; codex itself
    // may still want to write transient state (session caches) under the dir
    // hierarchy, so the parent must be writable by `node`.
    "RUN mkdir -p /home/node/.codex && chown -R node:node /home/node/.codex",
    "USER node",
    // `corepack prepare` populates the invoking user's cache
    // (~/.cache/node/corepack/). Running it as root above would leave node's
    // cache empty, forcing corepack to re-download pnpm on the agent's first
    // `pnpm <cmd>` invocation -- ~10 s of wasted wall clock per solve.
    `RUN corepack prepare ${pnpmSpec} --activate`,
    "",
  ].join("\n");
}

let imagePromise: Promise<void> | undefined;

/**
 * Ensure the container image exists, building it on first invocation.
 * Uses a module-level promise to guarantee at most one build.
 */
export function ensureImage(): Promise<void> {
  if (!imagePromise) {
    imagePromise = (async () => {
      try {
        execFileSync("podman", ["image", "exists", getImageName()], {
          stdio: "pipe",
          timeout: 10_000,
        });
        return;
      } catch {
        // Image does not exist, build it below
      }

      console.log("Building container image (first run)...");
      const containerfile = getContainerfileContent();
      // Use an empty scratch directory as the build context. The Containerfile
      // has no COPY/ADD instructions, but `podman build .` would tar up the
      // caller's CWD (typically the SDK monorepo root) -- which contains
      // symlinks like `node_modules/@tailor-platform/sdk -> ../packages/sdk`
      // that podman refuses to follow out of the context root, aborting the
      // build entirely.
      const contextDir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-challenge-build-"));
      try {
        execFileSync("podman", ["build", "-t", getImageName(), "-f", "-", contextDir], {
          input: containerfile,
          stdio: ["pipe", "inherit", "inherit"],
          timeout: 300_000,
        });
      } finally {
        fs.rmSync(contextDir, { recursive: true, force: true });
      }
      console.log("Container image built successfully.");
    })().catch((err: unknown) => {
      // Clear cached promise so the next call retries the build
      // (e.g., transient network failure during apt-get).
      imagePromise = undefined;
      throw err;
    });
  }
  return imagePromise;
}

/**
 * Build `podman run` arguments for executing the codex CLI inside the
 * container.
 *
 * - Volume-mounts host `workDir` to `/workspace` inside the container (RW).
 * - Bind-mounts the host's `~/.codex/auth.json` read-only into the container's
 *   `CODEX_HOME` so codex picks up the ChatGPT subscription credential.
 *   Nothing else from the host filesystem is mounted, so global AGENTS.md,
 *   skills, and dotfiles are physically unreachable from inside the container.
 * - Sets `CODEX_HOME=/home/node/.codex` so codex does not probe alternative
 *   config locations.
 *
 * The container has no network restrictions imposed by us; codex itself
 * reaches `api.openai.com`. We deliberately do NOT add `host.containers.internal`
 * since no host-side service is needed.
 */
export function buildContainerRunArgs(
  cliArgs: string[],
  options: {
    workDir: string;
    codexAuthPath: string;
  },
): string[] {
  const args = ["run", "--rm", "-i"];

  args.push("--volume", `${options.workDir}:${CONTAINER_WORK_DIR}:Z`);
  args.push("--workdir", CONTAINER_WORK_DIR);

  args.push("--volume", `${options.codexAuthPath}:${CONTAINER_CODEX_AUTH}:ro,Z`);
  args.push("--env", `CODEX_HOME=${CONTAINER_CODEX_HOME}`);
  // Mark the shell as non-interactive so pnpm/corepack skip TTY-only prompts
  // (e.g. confirmModulesPurge) instead of aborting with
  // ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY when the solver re-runs install.
  args.push("--env", "CI=true");

  args.push(getImageName());
  args.push("codex", ...cliArgs);

  return args;
}
