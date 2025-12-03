import { existsSync } from "node:fs";
import { cp, rename } from "node:fs/promises";
import { join } from "node:path";
import { spinner } from "@clack/prompts";
import { Context } from "./context";

export const copyProject = async (ctx: Context) => {
  const s = spinner();
  s.start("📋 Copying template files...");
  await cp(ctx.templateDir, ctx.projectDir, {
    recursive: true,
    force: true,
  });

  // Rename __dot__gitignore to .gitignore
  // refs: https://github.com/npm/cli/issues/5756
  const dotGitignorePath = join(ctx.projectDir, "__dot__gitignore");
  if (existsSync(dotGitignorePath)) {
    await rename(dotGitignorePath, join(ctx.projectDir, ".gitignore"));
  }
  s.stop("✅ Template copied");
};
