#!/usr/bin/env node
import { chdir } from "node:process";
import { intro, outro } from "@clack/prompts";
import { defineCommand, runMain } from "@politty/zod";
import pc from "picocolors";
import { readPackageJSON } from "pkg-types";
import { args } from "./args";
import { collectContext } from "./context";
import { copyProject } from "./copy";
import { initProject } from "./init";

const main = async () => {
  const packageJson = await readPackageJSON(import.meta.url);

  const cmd = defineCommand({
    name: packageJson.name ?? "create-sdk",
    description: packageJson.description,
    args,
    async run(args) {
      intro(pc.bold(pc.cyan("✨ Welcome to Tailor Platform SDK")));

      const ctx = await collectContext({
        name: args.name,
        template: args.template,
      });

      await copyProject(ctx);

      chdir(ctx.projectDir);

      await initProject();

      outro(
        pc.green("🎉 Project created successfully!") +
          "\n\n" +
          pc.dim("Next steps:") +
          "\n" +
          `  ${pc.cyan(`cd ${ctx.projectName}`)}` +
          "\n" +
          `  ${pc.dim("Check README.md and deploy your project")}` +
          "\n\n" +
          pc.dim("Learn more: https://docs.tailor.tech"),
      );
    },
  });

  await runMain(cmd, { version: packageJson.version });
};

await main();
