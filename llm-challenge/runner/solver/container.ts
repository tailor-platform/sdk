import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { SolveAgent } from "./types";

const IMAGE_NAME = "llm-challenge-runner";

/**
 * Fixed working directory inside the container.
 *
 * Host workDir (e.g. /var/folders/.../sdk-ws-xxx) is mounted here to avoid
 * macOS-specific paths leaking into the container. Codex's bubblewrap sandbox
 * derives writable roots from the working directory path, and macOS paths
 * like /Users/<name>/Library cause sandbox startup failures in Linux.
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
    "RUN npm install -g @anthropic-ai/claude-code @openai/codex",
    // Pre-create writable config dirs for both agents before switching to
    // non-root user. Codex writes logs/state to ~/.codex/ at runtime.
    "RUN mkdir -p /home/node/.codex /home/node/.claude && chown -R node:node /home/node/.codex /home/node/.claude",
    // Run as non-root user. Claude Code's --permission-mode bypassPermissions
    // refuses to run as root for security reasons.
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
 * Build `podman run` arguments for executing an agent CLI inside the container.
 *
 * - Volume-mounts host workDir to /workspace inside the container
 * - Mounts agent auth directories read-only for login-based credentials:
 *   - Claude: CLAUDE_CODE_OAUTH_TOKEN env var (from `claude setup-token`)
 *   - Codex: ~/.codex/ mounted to /home/node/.codex (contains auth.json)
 * - Adds `-i` for agents that pipe prompts via stdin (Codex)
 */
export function buildContainerRunArgs(
  agent: SolveAgent,
  cliArgs: string[],
  options?: { workDir?: string; stdin?: boolean },
): string[] {
  const args = ["run", "--rm"];

  if (options?.workDir) {
    args.push("--volume", `${options.workDir}:${CONTAINER_WORK_DIR}:Z`);
    args.push("--workdir", CONTAINER_WORK_DIR);
  }

  // Auth: mount config dirs or pass env vars depending on agent.
  // Container runs as USER node (HOME=/home/node).
  //
  // Security model: credentials (CLAUDE_CODE_OAUTH_TOKEN / auth.json) are intentionally
  // passed into the container because the agent must be authenticated to call the API.
  // Both Claude Code (--permission-mode bypassPermissions) and Codex
  // (--dangerously-bypass-approvals-and-sandbox) run with tool restrictions disabled,
  // which means a prompt-injected or malicious task could in principle exfiltrate these
  // credentials. This is an accepted trade-off: the Podman container already reduces the
  // attack surface to only the workspace directory and a single credential, compared to
  // running the agent on the host where it could access the entire filesystem.
  const homeDir = os.homedir();
  if (agent === "claude") {
    // Claude Code: OAuth token via env var (file-based auth not available;
    // mounting ~/.claude causes startup errors with .claude.json writes)
    args.push("--env", "CLAUDE_CODE_OAUTH_TOKEN");
  } else {
    // Codex: mount only auth.json read-only (ChatGPT OAuth tokens).
    // Mounting the entire ~/.codex/ would also bring in config.toml which may
    // contain host-specific writable_roots (e.g. /Users/<name>/Library) that
    // cause sandbox startup failures inside the Linux container.
    const codexAuth = path.join(homeDir, ".codex", "auth.json");
    args.push("--volume", `${codexAuth}:/home/node/.codex/auth.json:ro,Z`);
  }

  if (options?.stdin) {
    args.push("-i");
  }

  args.push(IMAGE_NAME);

  args.push(agent, ...cliArgs);

  return args;
}
