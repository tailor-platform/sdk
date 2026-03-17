import { execFileSync } from "node:child_process";
import type { SolveAgent } from "./types";

const IMAGE_NAME = "llm-challenge-runner";

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
    "RUN corepack enable && corepack prepare pnpm@latest --activate",
    "RUN npm install -g @anthropic-ai/claude-code @openai/codex",
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
    })();
  }
  return imagePromise;
}

/**
 * Build `podman run` arguments for executing an agent CLI inside the container.
 *
 * - Volume-mounts workDir at the same host path (preserves symlinks)
 * - Passes through auth environment variables (CLAUDE_CODE_OAUTH_TOKEN
 *   for Claude, OPENAI_API_KEY for Codex) so that token-based auth works
 * - Adds `-i` for agents that pipe prompts via stdin (Codex)
 *
 * Auth directories (~/.claude, ~/.codex) are NOT mounted because:
 * - Claude Code attempts to write config files (.claude.json) which fails
 *   on read-only mounts and causes startup errors
 * - Auth is handled entirely via environment variables
 */
export function buildContainerRunArgs(
  agent: SolveAgent,
  cliArgs: string[],
  options?: { workDir?: string; stdin?: boolean },
): string[] {
  const args = ["run", "--rm"];

  if (options?.workDir) {
    args.push("--volume", `${options.workDir}:${options.workDir}:Z`);
    args.push("--workdir", options.workDir);
  }

  // Pass through auth environment variables.
  // For Claude: CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`)
  // For Codex: OPENAI_API_KEY
  // podman --env VAR passes the host value; if unset, it is silently ignored.
  if (agent === "claude") {
    args.push("--env", "CLAUDE_CODE_OAUTH_TOKEN");
  } else {
    args.push("--env", "OPENAI_API_KEY");
  }

  if (options?.stdin) {
    args.push("-i");
  }

  args.push(IMAGE_NAME);

  const command = agent === "claude" ? "claude" : "codex";
  args.push(command, ...cliArgs);

  return args;
}
