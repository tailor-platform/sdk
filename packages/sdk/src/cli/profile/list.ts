import { defineCommand } from "citty";
import { consola } from "consola";
import ml from "multiline-ts";
import { commonArgs, jsonArgs, withCommonArgs } from "../args";
import { readPlatformConfig } from "../context";
import { printData } from "../format";
import type { ProfileInfo } from ".";

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List all profiles",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
  },
  run: withCommonArgs(async (args) => {
    const config = readPlatformConfig();

    const profiles = Object.entries(config.profiles);
    if (profiles.length === 0) {
      consola.info(ml`
        No profiles found.
        Please create a profile first using 'tailor-sdk profile create' command.
      `);
      return;
    }

    const profileInfos: ProfileInfo[] = profiles.map(([name, profile]) => ({
      name,
      user: profile!.user,
      workspaceId: profile!.workspace_id,
    }));
    printData(profileInfos, args.json);
  }),
});
