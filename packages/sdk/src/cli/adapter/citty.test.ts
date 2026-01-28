import { describe, it, expect } from "vitest";
import { adapter, type ArgsDefinition } from "./index";

/**
 * Argument definitions for testing
 * These mirror the actual definitions in args.ts
 */
const commonArgs = {
  "env-file": {
    type: "string",
    description: "Path to the environment file (error if not found)",
    alias: "e",
  },
  "env-file-if-exists": {
    type: "string",
    description: "Path to the environment file (ignored if not found)",
  },
  verbose: {
    type: "boolean",
    description: "Enable verbose logging",
    default: false,
  },
} as const satisfies ArgsDefinition;

const workspaceArgs = {
  "workspace-id": {
    type: "string",
    description: "Workspace ID",
    alias: "w",
  },
  profile: {
    type: "string",
    description: "Workspace profile",
    alias: "p",
  },
} as const satisfies ArgsDefinition;

const deploymentArgs = {
  ...workspaceArgs,
  config: {
    type: "string",
    description: "Path to SDK config file",
    alias: "c",
    default: "tailor.config.ts",
  },
} as const satisfies ArgsDefinition;

const confirmationArgs = {
  yes: {
    type: "boolean",
    description: "Skip confirmation prompts",
    alias: "y",
    default: false,
  },
} as const satisfies ArgsDefinition;

const jsonArgs = {
  json: {
    type: "boolean",
    description: "Output as JSON",
    alias: "j",
    default: false,
  },
} as const satisfies ArgsDefinition;

describe("argument parsing", () => {
  describe("string options", () => {
    it("parses --config with value", () => {
      const result = adapter.parseArgs(["--config", "custom.ts"], deploymentArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.config).toBe("custom.ts");
      }
    });

    it("parses -c alias with value", () => {
      const result = adapter.parseArgs(["-c", "custom.ts"], deploymentArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.config).toBe("custom.ts");
      }
    });

    it("parses --config=value format", () => {
      const result = adapter.parseArgs(["--config=custom.ts"], deploymentArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.config).toBe("custom.ts");
      }
    });

    it("uses default value when not specified", () => {
      const result = adapter.parseArgs([], deploymentArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.config).toBe("tailor.config.ts");
      }
    });

    it("parses --workspace-id with value", () => {
      const result = adapter.parseArgs(["--workspace-id", "ws-123"], workspaceArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args["workspace-id"]).toBe("ws-123");
      }
    });

    it("parses -w alias with value", () => {
      const result = adapter.parseArgs(["-w", "ws-123"], workspaceArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args["workspace-id"]).toBe("ws-123");
      }
    });

    it("parses --env-file with value", () => {
      const result = adapter.parseArgs(["--env-file", ".env.local"], commonArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args["env-file"]).toBe(".env.local");
      }
    });

    it("parses -e alias with value", () => {
      const result = adapter.parseArgs(["-e", ".env.local"], commonArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args["env-file"]).toBe(".env.local");
      }
    });
  });

  describe("boolean flags", () => {
    it("sets true when --verbose is provided", () => {
      const result = adapter.parseArgs(["--verbose"], commonArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.verbose).toBe(true);
      }
    });

    it("defaults to false when flag is not provided", () => {
      const result = adapter.parseArgs([], commonArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.verbose).toBe(false);
      }
    });

    it("parses -y alias for --yes", () => {
      const result = adapter.parseArgs(["-y"], confirmationArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.yes).toBe(true);
      }
    });

    it("parses --json flag", () => {
      const result = adapter.parseArgs(["--json"], jsonArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.json).toBe(true);
      }
    });

    it("parses -j alias for --json", () => {
      const result = adapter.parseArgs(["-j"], jsonArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.json).toBe(true);
      }
    });
  });

  describe("positional arguments", () => {
    const positionalArgs = {
      name: {
        type: "positional",
        description: "Project name",
        required: true,
      },
    } as const satisfies ArgsDefinition;

    it("captures positional argument", () => {
      const result = adapter.parseArgs(["my-project"], positionalArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.name).toBe("my-project");
      }
    });

    it("captures positional argument with dashes", () => {
      const result = adapter.parseArgs(["my-project-name"], positionalArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.name).toBe("my-project-name");
      }
    });
  });

  describe("combined patterns", () => {
    const combinedArgs = {
      ...workspaceArgs,
      ...commonArgs,
    } as const satisfies ArgsDefinition;

    it("parses multiple options together", () => {
      const result = adapter.parseArgs(
        ["-w", "ws-id", "-p", "profile-name", "--verbose"],
        combinedArgs,
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args["workspace-id"]).toBe("ws-id");
        expect(result.args.profile).toBe("profile-name");
        expect(result.args.verbose).toBe(true);
      }
    });

    it("parses options in any order", () => {
      const result = adapter.parseArgs(
        ["--verbose", "--workspace-id", "ws-id", "--profile", "profile-name"],
        combinedArgs,
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args["workspace-id"]).toBe("ws-id");
        expect(result.args.profile).toBe("profile-name");
        expect(result.args.verbose).toBe(true);
      }
    });

    it("handles mixed long and short options", () => {
      const result = adapter.parseArgs(["-w", "ws-id", "--verbose"], combinedArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args["workspace-id"]).toBe("ws-id");
        expect(result.args.verbose).toBe(true);
      }
    });
  });

  describe("default values", () => {
    it("applies default for string option", () => {
      const result = adapter.parseArgs([], deploymentArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.config).toBe("tailor.config.ts");
      }
    });

    it("applies default for boolean flag", () => {
      const result = adapter.parseArgs([], commonArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.verbose).toBe(false);
      }
    });

    it("overrides default when value provided", () => {
      const result = adapter.parseArgs(["--config", "other.ts"], deploymentArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.config).toBe("other.ts");
      }
    });

    it("returns undefined for optional string without default", () => {
      const result = adapter.parseArgs([], workspaceArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args["workspace-id"]).toBeUndefined();
        expect(result.args.profile).toBeUndefined();
      }
    });
  });

  describe("positional with options", () => {
    const profileCreateArgs = {
      ...commonArgs,
      ...jsonArgs,
      name: {
        type: "positional",
        description: "Profile name",
        required: true,
      },
      user: {
        type: "string",
        description: "User email",
        required: true,
        alias: "u",
      },
      "workspace-id": {
        type: "string",
        description: "Workspace ID",
        required: true,
        alias: "w",
      },
    } as const satisfies ArgsDefinition;

    it("parses positional argument with options", () => {
      const result = adapter.parseArgs(
        ["my-profile", "-u", "user@example.com", "-w", "ws-123"],
        profileCreateArgs,
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.name).toBe("my-profile");
        expect(result.args.user).toBe("user@example.com");
        expect(result.args["workspace-id"]).toBe("ws-123");
      }
    });

    it("parses positional argument at the end", () => {
      const result = adapter.parseArgs(
        ["-u", "user@example.com", "-w", "ws-123", "my-profile"],
        profileCreateArgs,
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.name).toBe("my-profile");
        expect(result.args.user).toBe("user@example.com");
        expect(result.args["workspace-id"]).toBe("ws-123");
      }
    });
  });

  describe("remaining arguments (_)", () => {
    it("collects unparsed arguments in _", () => {
      const result = adapter.parseArgs(["--verbose", "--", "extra", "args"], commonArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.verbose).toBe(true);
        expect(result.args._).toContain("extra");
        expect(result.args._).toContain("args");
      }
    });

    it("returns empty _ when no extra arguments", () => {
      const result = adapter.parseArgs(["--verbose"], commonArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args._).toEqual([]);
      }
    });
  });
});

describe("error handling", () => {
  describe("missing required arguments", () => {
    const requiredArgs = {
      name: {
        type: "string",
        description: "Name",
        required: true,
      },
    } as const satisfies ArgsDefinition;

    it("returns error for missing required string option", () => {
      const result = adapter.parseArgs([], requiredArgs);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.kind).toBe("missing_required");
        expect(result.error.name).toBe("name");
      }
    });

    it("succeeds when required option is provided", () => {
      const result = adapter.parseArgs(["--name", "value"], requiredArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.name).toBe("value");
      }
    });
  });

  describe("missing required positional argument", () => {
    const positionalArgs = {
      projectName: {
        type: "positional",
        description: "Project name",
        required: true,
      },
    } as const satisfies ArgsDefinition;

    it("returns error for missing required positional", () => {
      const result = adapter.parseArgs([], positionalArgs);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.kind).toBe("missing_required");
      }
    });

    it("succeeds when positional is provided", () => {
      const result = adapter.parseArgs(["my-project"], positionalArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.projectName).toBe("my-project");
      }
    });
  });

  describe("multiple required arguments", () => {
    const multiRequiredArgs = {
      user: {
        type: "string",
        description: "User email",
        required: true,
        alias: "u",
      },
      "workspace-id": {
        type: "string",
        description: "Workspace ID",
        required: true,
        alias: "w",
      },
    } as const satisfies ArgsDefinition;

    it("returns error when first required is missing", () => {
      const result = adapter.parseArgs(["--workspace-id", "ws-123"], multiRequiredArgs);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.kind).toBe("missing_required");
        expect(result.error.name).toBe("user");
      }
    });

    it("returns error when second required is missing", () => {
      const result = adapter.parseArgs(["--user", "test@example.com"], multiRequiredArgs);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.kind).toBe("missing_required");
        expect(result.error.name).toBe("workspace-id");
      }
    });

    it("succeeds when all required are provided", () => {
      const result = adapter.parseArgs(
        ["-u", "test@example.com", "-w", "ws-123"],
        multiRequiredArgs,
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.user).toBe("test@example.com");
        expect(result.args["workspace-id"]).toBe("ws-123");
      }
    });
  });

  describe("optional arguments", () => {
    const optionalArgs = {
      config: {
        type: "string",
        description: "Config file",
        default: "tailor.config.ts",
      },
      verbose: {
        type: "boolean",
        description: "Verbose output",
        default: false,
      },
    } as const satisfies ArgsDefinition;

    it("succeeds with empty args using defaults", () => {
      const result = adapter.parseArgs([], optionalArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.config).toBe("tailor.config.ts");
        expect(result.args.verbose).toBe(false);
      }
    });

    it("overrides defaults when values provided", () => {
      const result = adapter.parseArgs(["--config", "custom.ts", "--verbose"], optionalArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.config).toBe("custom.ts");
        expect(result.args.verbose).toBe(true);
      }
    });
  });

  describe("mixed required and optional", () => {
    const mixedArgs = {
      name: {
        type: "positional",
        description: "Profile name",
        required: true,
      },
      user: {
        type: "string",
        description: "User email",
        required: true,
        alias: "u",
      },
      verbose: {
        type: "boolean",
        description: "Verbose output",
        default: false,
      },
    } as const satisfies ArgsDefinition;

    it("returns error when required args missing but optional provided", () => {
      const result = adapter.parseArgs(["--verbose"], mixedArgs);
      expect(result.success).toBe(false);
    });

    it("succeeds when all required provided with defaults applied", () => {
      const result = adapter.parseArgs(["my-profile", "-u", "user@example.com"], mixedArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args.name).toBe("my-profile");
        expect(result.args.user).toBe("user@example.com");
        expect(result.args.verbose).toBe(false);
      }
    });
  });

  describe("error result structure", () => {
    const args = {
      required: {
        type: "string",
        description: "Required field",
        required: true,
      },
    } as const satisfies ArgsDefinition;

    it("error result has correct shape", () => {
      const result = adapter.parseArgs([], args);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeDefined();
        expect(typeof result.error.kind).toBe("string");
        expect(typeof result.error.name).toBe("string");
      }
    });

    it("success result has correct shape", () => {
      const result = adapter.parseArgs(["--required", "value"], args);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.args).toBeDefined();
        expect(result.args.required).toBe("value");
        expect(result.args._).toBeDefined();
        expect(Array.isArray(result.args._)).toBe(true);
      }
    });
  });
});
