import { defineCommand } from "citty";
import { consola } from "consola";
import ml from "multiline-ts";
import {
  commonArgs,
  formatArgs,
  parseFormat,
  printWithFormat,
  withCommonArgs,
} from "../args";
import { readPlatformConfig } from "../context";
import type { ProfileInfo } from ".";

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List all profiles",
  },
  args: {
    ...commonArgs,
    ...formatArgs,
  },
  run: withCommonArgs(async (args) => {
    // Validate args
    const format = parseFormat(args.format);

    const config = readPlatformConfig();

    const profiles = Object.entries(config.profiles);
    if (profiles.length === 0) {
      consola.info(ml`
        No profiles found.
        Please create a profile first using 'tailor-sdk profile create' command.
      `);
      return;
    }

    // Show profiles info
    const profileInfos: ProfileInfo[] = profiles.map(([name, profile]) => ({
      name,
      user: profile!.user,
      workspaceId: profile!.workspace_id,
    }));
    printWithFormat(profileInfos, format);
  }),
});
