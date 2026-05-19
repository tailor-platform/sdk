import { execFileSync } from "node:child_process";

const IMAGE_NAME = "llm-challenge-runner";

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
  return [
    "FROM node:22-slim",
    "RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*",
    "RUN corepack enable && corepack prepare pnpm@latest --activate",
    "RUN npm install -g @openai/codex",
    // Pre-create the writable CODEX_HOME slot before switching to non-root user.
    // The host's auth.json is bind-mounted read-only at runtime; codex itself
    // may still want to write transient state (session caches) under the dir
    // hierarchy, so the parent must be writable by `node`.
    "RUN mkdir -p /home/node/.codex && chown -R node:node /home/node/.codex",
    "USER node",
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
        execFileSync("podman", ["image", "exists", IMAGE_NAME], {
          stdio: "pipe",
          timeout: 10_000,
        });
        return;
      } catch {
        // Image does not exist, build it below
      }

      console.log("Building container image (first run)...");
      const containerfile = getContainerfileContent();
      execFileSync("podman", ["build", "-t", IMAGE_NAME, "-f", "-", "."], {
        input: containerfile,
        stdio: ["pipe", "inherit", "inherit"],
        timeout: 300_000,
      });
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

  args.push(IMAGE_NAME);
  args.push("codex", ...cliArgs);

  return args;
}
