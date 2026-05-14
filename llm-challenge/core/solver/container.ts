import { execFileSync } from "node:child_process";

const IMAGE_NAME = "llm-challenge-runner";

/**
 * Fixed working directory inside the container.
 *
 * Host workDir (e.g. /var/folders/.../sdk-ws-xxx) is mounted here to avoid
 * macOS-specific paths leaking into the container.
 */
export const CONTAINER_WORK_DIR = "/workspace";

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
    "RUN npm install -g opencode-ai",
    // Pre-create writable config dirs before switching to non-root user.
    // opencode looks under ~/.config/opencode and ~/.local/share/opencode.
    "RUN mkdir -p /home/node/.config/opencode /home/node/.local/share/opencode && chown -R node:node /home/node/.config /home/node/.local",
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
 * Build `podman run` arguments for executing the opencode CLI inside the
 * container.
 *
 * - Volume-mounts host workDir to /workspace inside the container
 * - Adds `--add-host host.containers.internal:host-gateway` so the container
 *   reaches the host's `ollama serve`
 * - Optionally mounts a per-iteration `opencode.json` (provider config +
 *   sampling options) read-only at the canonical XDG path
 *
 * No credentials are passed: local Ollama on the host needs none.
 */
export function buildContainerRunArgs(
  cliArgs: string[],
  options?: {
    workDir?: string;
    opencodeConfigPath?: string;
  },
): string[] {
  const args = ["run", "--rm"];

  if (options?.workDir) {
    args.push("--volume", `${options.workDir}:${CONTAINER_WORK_DIR}:Z`);
    args.push("--workdir", CONTAINER_WORK_DIR);
  }

  // Container reaches host's `ollama serve` through `host.containers.internal`.
  // On Podman 5.x macOS this requires the explicit `--add-host` mapping below
  // (verified via `curl http://host.containers.internal:11434/api/tags`).
  args.push("--add-host", "host.containers.internal:host-gateway");
  if (options?.opencodeConfigPath) {
    // Mount the per-iteration `opencode.json` read-only at the canonical XDG
    // path. opencode probes config.json / opencode.json / opencode.jsonc under
    // this dir and picks up whichever it finds.
    args.push(
      "--volume",
      `${options.opencodeConfigPath}:/home/node/.config/opencode/opencode.json:ro,Z`,
    );
  }

  args.push(IMAGE_NAME);
  args.push("opencode", ...cliArgs);

  return args;
}
