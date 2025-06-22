import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { styleText } from "node:util";
import ini from "ini";
import ml from "multiline-ts";
import { ApplyOptions } from "./cli/args";

interface CtlConfig {
  name: string;
  username: string;
  workspaceId: string;
  workspaceName: string;
}

export class TailorCtl {
  private ctlConfig: CtlConfig;

  constructor(private options: ApplyOptions) {
    if (options.dryRun) {
      this.ctlConfig = {
        name: "",
        username: "",
        workspaceId: "",
        workspaceName: "",
      };
    } else {
      this.init();
      this.ctlConfig = this.execJson("config", "describe");
    }
  }

  private login() {
    this.spawn("auth", "login");
  }

  private init() {
    const config = this.loadIni();
    if (
      config &&
      new Date(config.controlplanetokenexpiresat).getTime() > Date.now()
    ) {
      return config;
    }

    this.login();
    return this.loadIni();
  }

  private loadIni() {
    const configs = ini.parse(
      fs.readFileSync(path.join(os.homedir(), ".tailorctl", "config"), "utf-8"),
    );
    return configs[configs.global?.context || "default"];
  }

  private spawn(...args: string[]) {
    if (this.options.dryRun) {
      console.log(`[Dry Run: spawn] tailorctl ${args.join(" ")}`);
      return "{}";
    }

    const result = spawnSync("tailorctl", args, { stdio: "inherit" });
    if (result.error) {
      throw new Error(`Failed to execute tailorctl: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(
        `tailorctl command failed with exit code ${result.status}`,
      );
    }

    return result;
  }

  private exec(...args: string[]) {
    if (this.options.dryRun) {
      console.log(`[Dry Run: exec] tailorctl ${args.join(" ")}`);
      return "{}";
    }
    return execSync(`tailorctl ${args.join(" ")}`).toString("utf-8");
  }

  private execJson(...args: string[]) {
    const output = this.exec(...[...args, "-f", "json"]);
    return JSON.parse(output);
  }

  async upsertWorkspace(workspace: {
    name: string;
    region: "asia-northeast" | "us-west";
  }) {
    if (this.ctlConfig.workspaceName === "") {
      console.log("Creating workspace...");
      this.exec(
        "workspace",
        "create",
        "-n",
        workspace.name,
        "-r",
        workspace.region,
      );
    } else if (workspace.name !== this.ctlConfig.workspaceName) {
      throw new Error(
        styleText(
          "red",
          ml`
            Workspace name mismatch: expected ${workspace.name}, got ${this.ctlConfig.workspaceName}
            Please select the correct config using: tailorctl config switch <config name>
            `,
        ),
      );
    }

    return this.execJson("workspace", "describe");
  }

  async apply(manifest: string) {
    this.spawn("workspace", "apply", "-m", manifest, "-a");
  }
}
