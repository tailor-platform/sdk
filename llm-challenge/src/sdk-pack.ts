import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCommand } from "./process";
import { createNoDocsTarball } from "./profile";

export type PackedSdk = {
  sdkRef: string;
  sdkVersion?: string;
  fullTarballPath: string;
  noDocsTarballPath?: string;
  codemodTarballPath: string;
  cleanup: () => Promise<void>;
};

export async function packSdk(options: {
  repoRoot: string;
  sdkRef: string;
  needNoDocs: boolean;
}): Promise<PackedSdk> {
  const resolvedRef = (
    await runCommand("git", ["rev-parse", "--verify", `${options.sdkRef}^{commit}`], {
      cwd: options.repoRoot,
    })
  ).stdout.trim();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "llm-challenge-sdk-"));
  const checkoutDir = path.join(tempRoot, "repo");
  const packDir = path.join(tempRoot, "pack");
  const codemodPackDir = path.join(tempRoot, "pack-codemod");
  await fs.mkdir(packDir, { recursive: true });
  await fs.mkdir(codemodPackDir, { recursive: true });

  let worktreeCreated = false;
  try {
    await runCommand("git", ["worktree", "add", "--detach", checkoutDir, resolvedRef], {
      cwd: options.repoRoot,
    });
    worktreeCreated = true;
    await runCommand("pnpm", ["install", "--frozen-lockfile"], { cwd: checkoutDir });
    await runCommand(
      "pnpm",
      ["--filter", "@tailor-platform/sdk", "--filter", "@tailor-platform/sdk-codemod", "build"],
      { cwd: checkoutDir },
    );
    const packageJson = JSON.parse(
      await fs.readFile(path.join(checkoutDir, "packages/sdk/package.json"), "utf8"),
    ) as { version?: string };

    await runCommand("pnpm", ["-C", "packages/sdk", "pack", "--pack-destination", packDir], {
      cwd: checkoutDir,
    });
    await runCommand(
      "pnpm",
      ["-C", "packages/sdk-codemod", "pack", "--pack-destination", codemodPackDir],
      { cwd: checkoutDir },
    );
    const fullTarballPath = await findOnlyTarball(packDir);
    const codemodTarballPath = await findOnlyTarball(codemodPackDir);
    const noDocsTarballPath = options.needNoDocs
      ? path.join(packDir, "tailor-platform-sdk-no-docs.tgz")
      : undefined;
    if (noDocsTarballPath !== undefined) {
      await createNoDocsTarball(fullTarballPath, noDocsTarballPath, tempRoot);
    }

    return {
      sdkRef: resolvedRef,
      sdkVersion: packageJson.version,
      fullTarballPath,
      noDocsTarballPath,
      codemodTarballPath,
      cleanup: async () => {
        if (worktreeCreated) {
          await runCommand("git", ["worktree", "remove", "--force", checkoutDir], {
            cwd: options.repoRoot,
          }).catch(async () => {
            await runCommand("git", ["worktree", "remove", "--force", "--force", checkoutDir], {
              cwd: options.repoRoot,
            }).catch(() => undefined);
          });
        }
        await fs.rm(tempRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (worktreeCreated) {
      await runCommand("git", ["worktree", "remove", "--force", "--force", checkoutDir], {
        cwd: options.repoRoot,
      }).catch(() => undefined);
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

async function findOnlyTarball(packDir: string): Promise<string> {
  const tarballs = (await fs.readdir(packDir))
    .filter((entry) => entry.endsWith(".tgz") && !entry.includes("no-docs"))
    .map((entry) => path.join(packDir, entry));
  if (tarballs.length !== 1) {
    throw new Error(`Expected exactly one SDK tarball in ${packDir}`);
  }
  return tarballs[0];
}
