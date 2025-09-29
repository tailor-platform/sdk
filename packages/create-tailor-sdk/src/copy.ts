import { cp } from "node:fs/promises";
import { spinner } from "@clack/prompts";
import { Context } from "./context";

export const copyProject = async (ctx: Context) => {
  const s = spinner();
  s.start("Copying template files");
  await cp(ctx.templateDir, ctx.projectDir, {
    recursive: true,
    force: true,
  });
  s.stop("Template files copied");
};
