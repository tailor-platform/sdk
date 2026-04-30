import { existsSync } from "node:fs";
import { cp, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spinner } from "@clack/prompts";
import { Context } from "./context";

// pnpm-workspace.yaml with allowBuilds for SDK and its transitive deps.
// This cannot live in the template source because the templates are
// workspace packages in the monorepo; a nested pnpm-workspace.yaml
// would break workspace:^ resolution.
const PNPM_WORKSPACE_YAML = `\
allowBuilds:
  "@prisma/engines": true
  "@swc/core": true
  "@tailor-platform/sdk": true
  esbuild: true
  protobufjs: true
`;

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

  // Generate pnpm-workspace.yaml for pnpm 10/11 build script allowlist
  await writeFile(join(ctx.projectDir, "pnpm-workspace.yaml"), PNPM_WORKSPACE_YAML);

  s.stop("✅ Template copied");
};
