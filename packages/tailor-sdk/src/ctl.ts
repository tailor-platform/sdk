import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { styleText } from "node:util";
import ini from "ini";
import ml from "multiline-ts";
import { WorkspaceConfig } from "./config";

interface CtlConfig {
  name: string;
  username: string;
  workspaceId: string;
  workspaceName: string;
}

export class TailorCtl {
  private ctlConfig: CtlConfig;

  constructor(private options: { dryRun?: boolean } = { dryRun: false }) {
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

    if (!process.env.TAILOR_TOKEN) {
      this.login();
    }
  }

  private loadIni() {
    const configPath = path.join(os.homedir(), ".tailorctl", "config");
    if (!fs.existsSync(configPath)) {
      return;
    }

    const configs = ini.parse(fs.readFileSync(configPath, "utf-8"));
    return configs[configs.global?.context || "default"];
  }

  private spawn(...args: string[]) {
    console.log(
      `[${this.options.dryRun ? "Dry Run: " : ""}spawn] tailorctl ${args.join(" ")}`,
    );
    if (this.options.dryRun) {
      return "{}";
    }

    const result = spawnSync("tailorctl", args, { stdio: "inherit" });
    if (result.error) {
      throw new Error(`Failed to execute tailorctl: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(
        `"tailorctl ${args.join(" ")}" command failed with exit code ${result.status}`,
      );
    }

    return result;
  }

  private exec(...args: string[]) {
    console.log(
      `[${this.options.dryRun ? "Dry Run: " : ""}exec] tailorctl ${args.join(" ")}`,
    );
    if (this.options.dryRun) {
      return "{}";
    }

    return execSync(`tailorctl ${args.join(" ")}`).toString("utf-8");
  }

  private execJson(...args: string[]) {
    const output = this.exec(...[...args, "-f", "json"]);
    return JSON.parse(output);
  }

  private async createWorkspaceIfNeeded(workspace: WorkspaceConfig) {
    if (workspace.id != null) {
      return this.execJson("workspace", "describe", "-w", workspace.id);
    }

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

    const description = this.execJson("workspace", "describe");
    if (workspace.region !== description.region) {
      throw new Error(
        styleText(
          "red",
          ml`
            Workspace region mismatch: expected ${workspace.region}, got ${description.region}
            If you want to change the region, please create a new workspace.
            `,
        ),
      );
    }

    return description;
  }

  async apply(workspace: WorkspaceConfig, manifest: string) {
    await this.createWorkspaceIfNeeded(workspace);
    this.spawn(
      "workspace",
      "apply",
      ...(workspace.id != null ? ["-w", workspace.id] : []),
      "-m",
      manifest,
      "-a",
    );
  }
}
