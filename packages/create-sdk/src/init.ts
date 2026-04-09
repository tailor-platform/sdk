import { log, spinner } from "@clack/prompts";
import { execa } from "execa";

const detectPackageManager = () => {
  const availablePMs = ["npm", "yarn", "pnpm", "bun"];
  const userAgent = process.env.npm_config_user_agent;
  if (!userAgent) return;
  const [name] = userAgent.split("/");
  if (!availablePMs.includes(name)) return;
  return name;
};

const isGitRepository = async () => {
  try {
    await execa("git", ["status"]);
    return true;
  } catch {
    return false;
  }
};

export const initProject = async () => {
  const packageManager = detectPackageManager();
  if (process.env.CREATE_SDK_NO_INSTALL) {
    log.info("ℹ️ Skipping dependency installation (CREATE_SDK_NO_INSTALL is set)");
  } else if (packageManager) {
    const s = spinner();
    s.start(`📦 Installing dependencies with ${packageManager}...`);
    await execa(packageManager, ["install"]);
    s.stop("✅ Dependencies installed");
  } else {
    log.warn("⚠️ Could not detect package manager, skipping dependency installation");
  }

  if (!(await isGitRepository())) {
    const s = spinner();
    s.start("🔧 Initializing git repository...");
    await execa("git", ["init"]);
    await execa("git", ["add", "."]);
    await execa("git", ["commit", "-m", "Initial commit (by create-sdk)"]);
    s.stop("✅ Git initialized");
  } else {
    log.warn("⚠️ Already inside a git repository, skipping git initialization");
  }
};
