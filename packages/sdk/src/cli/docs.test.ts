import { assertDocMatch, createCommandRenderer } from "politty/docs";
import { describe, it, vi } from "vitest";
import { mainCommand } from "./index";
import type { FileConfig, OptionsRenderContext } from "politty/docs";

vi.mock("node:module", async () => {
  const actual = await vi.importActual("node:module");
  return { ...actual, register: vi.fn() };
});

vi.mock("politty", async () => {
  const actual = await vi.importActual("politty");
  return { ...actual, runMain: vi.fn() };
});

// Options to exclude from documentation (commonArgs)
const excludedOptions = new Set(["env-file", "env-file-if-exists", "verbose"]);

/**
 * Custom options renderer that filters out commonArgs
 * @param context - Options render context from politty
 * @returns Rendered options markdown without commonArgs
 */
function renderOptionsWithoutCommonArgs(context: OptionsRenderContext): string {
  const filteredOptions = context.options.filter((opt) => !excludedOptions.has(opt.name));
  if (filteredOptions.length === 0) {
    return "";
  }
  return context.render(filteredOptions);
}

/**
 * Create a command renderer that excludes commonArgs from options
 * @param headingLevel - Heading level for the command documentation
 * @returns Command renderer function
 */
function createRenderer(headingLevel: 1 | 2 | 3 | 4 | 5 | 6) {
  return createCommandRenderer({
    headingLevel,
    renderOptions: renderOptionsWithoutCommonArgs,
  });
}

// Application Commands - top-level commands
const applicationConfig: FileConfig = {
  commands: ["init", "generate", "apply", "remove", "show", "open", "api"],
  render: createRenderer(1),
};

// TailorDB Commands - tailordb and subcommands
const tailordbConfig: FileConfig = {
  commands: [
    "tailordb",
    "tailordb truncate",
    "tailordb migration",
    "tailordb migration generate",
    "tailordb migration set",
    "tailordb migration status",
    "tailordb erd",
    "tailordb erd export",
    "tailordb erd serve",
    "tailordb erd deploy",
  ],
  render: createRenderer(1),
};

// User Commands - login, logout, user and subcommands
const userConfig: FileConfig = {
  commands: [
    "login",
    "logout",
    "user",
    "user current",
    "user list",
    "user switch",
    "user pat",
    "user pat list",
    "user pat create",
    "user pat delete",
    "user pat update",
  ],
  render: createRenderer(1),
};

// Workspace Commands - workspace and profile subcommands
const workspaceConfig: FileConfig = {
  commands: [
    "workspace",
    "workspace create",
    "workspace list",
    "workspace delete",
    "profile",
    "profile create",
    "profile list",
    "profile update",
    "profile delete",
  ],
  render: createRenderer(1),
};

// Auth Resource Commands - machineuser and oauth2client
const authConfig: FileConfig = {
  commands: [
    "machineuser",
    "machineuser list",
    "machineuser token",
    "oauth2client",
    "oauth2client list",
    "oauth2client get",
  ],
  render: createRenderer(1),
};

// Workflow Commands - workflow and subcommands
const workflowConfig: FileConfig = {
  commands: [
    "workflow",
    "workflow list",
    "workflow get",
    "workflow start",
    "workflow executions",
    "workflow resume",
  ],
  render: createRenderer(1),
};

// Secret Commands - secret and vault subcommands
const secretConfig: FileConfig = {
  commands: [
    "secret",
    "secret vault",
    "secret vault create",
    "secret vault delete",
    "secret vault list",
    "secret create",
    "secret update",
    "secret list",
    "secret delete",
  ],
  render: createRenderer(1),
};

// Static Website Commands - staticwebsite and subcommands
const staticwebsiteConfig: FileConfig = {
  commands: ["staticwebsite", "staticwebsite deploy", "staticwebsite list", "staticwebsite get"],
  render: createRenderer(1),
};

const files = {
  "docs/cli/application.md": applicationConfig,
  "docs/cli/tailordb.md": tailordbConfig,
  "docs/cli/user.md": userConfig,
  "docs/cli/workspace.md": workspaceConfig,
  "docs/cli/auth.md": authConfig,
  "docs/cli/workflow.md": workflowConfig,
  "docs/cli/secret.md": secretConfig,
  "docs/cli/staticwebsite.md": staticwebsiteConfig,
};

// All target commands across all files
const targetCommands = [
  // application.md
  "init",
  "generate",
  "apply",
  "remove",
  "show",
  "open",
  "api",
  // tailordb.md
  "tailordb",
  "tailordb truncate",
  "tailordb migration",
  "tailordb migration generate",
  "tailordb migration set",
  "tailordb migration status",
  "tailordb erd",
  "tailordb erd export",
  "tailordb erd serve",
  "tailordb erd deploy",
  // user.md
  "login",
  "logout",
  "user",
  "user current",
  "user list",
  "user switch",
  "user pat",
  "user pat list",
  "user pat create",
  "user pat delete",
  "user pat update",
  // workspace.md
  "workspace",
  "workspace create",
  "workspace list",
  "workspace delete",
  "profile",
  "profile create",
  "profile list",
  "profile update",
  "profile delete",
  // auth.md
  "machineuser",
  "machineuser list",
  "machineuser token",
  "oauth2client",
  "oauth2client list",
  "oauth2client get",
  // workflow.md
  "workflow",
  "workflow list",
  "workflow get",
  "workflow start",
  "workflow executions",
  "workflow resume",
  // secret.md
  "secret",
  "secret vault",
  "secret vault create",
  "secret vault delete",
  "secret vault list",
  "secret create",
  "secret update",
  "secret list",
  "secret delete",
  // staticwebsite.md
  "staticwebsite",
  "staticwebsite deploy",
  "staticwebsite list",
  "staticwebsite get",
];

describe("CLI Documentation", () => {
  it("matches golden files", async () => {
    await assertDocMatch({ command: mainCommand, files, targetCommands });
  });
});
