import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import fs from "fs-extra";
import path from "node:path";
import inquirer from "inquirer";
import { spawn } from "node:child_process";

import {
  validateProjectName,
  generatePackageJson,
  generateTailorConfig,
  checkExistingProject,
  addToExistingProject,
  initCommand,
} from "./init";

// Mock fs-extra
vi.mock("fs-extra");
// Mock inquirer
vi.mock("inquirer");
// Mock child_process
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

describe("init command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("validateProjectName", () => {
    it("should accept valid project names", () => {
      expect(validateProjectName("my-project")).toBe(true);
      expect(validateProjectName("project123")).toBe(true);
      expect(validateProjectName("test-app-2")).toBe(true);
      expect(validateProjectName("ab")).toBe(true);
    });

    it("should reject names that are too short", () => {
      const result = validateProjectName("a");
      expect(result).toContain("at least 2 characters");
    });

    it("should reject names that are too long", () => {
      const longName = "a".repeat(51);
      const result = validateProjectName(longName);
      expect(result).toContain("50 characters or less");
    });

    it("should reject names starting with non-alphanumeric", () => {
      const result = validateProjectName("-project");
      expect(result).toContain("start with a letter or number");
    });

    it("should reject names ending with non-alphanumeric", () => {
      const result = validateProjectName("project-");
      expect(result).toContain("end with a letter or number");
    });

    it("should reject names with invalid characters", () => {
      const result = validateProjectName("my_project");
      expect(result).toContain("letters, numbers, and hyphens");
    });

    it("should reject names with consecutive hyphens", () => {
      const result = validateProjectName("my--project");
      expect(result).toContain("consecutive hyphens");
    });

    it("should reject uppercase names", () => {
      const result = validateProjectName("MyProject");
      expect(result).toContain("lowercase");
    });
  });

  describe("generatePackageJson", () => {
    it("should generate correct package.json structure", () => {
      const result = generatePackageJson("test-project");

      expect(result).toEqual({
        name: "test-project",
        version: "0.1.0",
        private: true,
        type: "module",
        scripts: {
          dev: "tailor-sdk generate --watch",
          build: "tailor-sdk generate",
          deploy: "tailor-sdk apply",
        },
        devDependencies: {
          "@tailor-platform/tailor-sdk": "latest",
          "@types/node": "22.13.14",
          typescript: "5.8.3",
        },
      });
    });
  });

  describe("generateTailorConfig", () => {
    it("should generate basic template config", () => {
      const config = generateTailorConfig(
        "test-project",
        "asia-northeast",
        "basic",
      );

      expect(config).toContain('name: "test-project"');
      expect(config).toContain('region: "asia-northeast"');
      expect(config).toContain("auth: {");
      expect(config).toContain('namespace: "main-auth"');
      expect(config).not.toContain("generators:");
    });

    it("should generate fullstack template config", () => {
      const config = generateTailorConfig(
        "test-project",
        "us-west",
        "fullstack",
      );

      expect(config).toContain('name: "test-project"');
      expect(config).toContain('region: "us-west"');
      expect(config).toContain("auth: {");
      expect(config).toContain("idProviderConfigs:");
      expect(config).toContain('userProfileProvider: "TAILORDB"');
      expect(config).toContain("generators:");
    });
  });

  describe("checkExistingProject", () => {
    it("should detect existing project with package.json", async () => {
      const pathExistsSpy = vi
        .spyOn(fs, "pathExists")
        .mockImplementation(async (filePath) => {
          return filePath.toString().includes("package.json");
        });

      const result = await checkExistingProject("/test/path");

      expect(result.hasPackageJson).toBe(true);
      expect(result.packageJsonPath).toBe(
        path.join("/test/path", "package.json"),
      );
      expect(pathExistsSpy).toHaveBeenCalledWith(
        path.join("/test/path", "package.json"),
      );
    });

    it("should detect project without package.json", async () => {
      vi.spyOn(fs, "pathExists").mockResolvedValue(false as never);

      const result = await checkExistingProject("/test/path");

      expect(result.hasPackageJson).toBe(false);
    });
  });

  describe("addToExistingProject", () => {
    beforeEach(() => {
      vi.spyOn(fs, "readJson").mockResolvedValue({
        name: "existing-project",
        version: "1.0.0",
        scripts: {
          test: "jest",
        },
        dependencies: {
          express: "^4.0.0",
        },
      });
      vi.spyOn(fs, "writeJson").mockResolvedValue(undefined);
      vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
      vi.spyOn(fs, "ensureDir").mockResolvedValue(undefined as never);
    });

    it("should add tailor-sdk to dependencies", async () => {
      const writeJsonSpy = vi.spyOn(fs, "writeJson");

      await addToExistingProject("/test/path", "asia-northeast", "basic");

      expect(writeJsonSpy).toHaveBeenCalledWith(
        "/test/path/package.json",
        expect.objectContaining({
          dependencies: expect.objectContaining({
            express: "^4.0.0",
          }),
          devDependencies: expect.objectContaining({
            "@tailor-platform/tailor-sdk": "latest",
          }),
        }),
        { spaces: 2 },
      );
    });

    it("should add tailor scripts to package.json", async () => {
      const writeJsonSpy = vi.spyOn(fs, "writeJson");

      await addToExistingProject("/test/path", "asia-northeast", "basic");

      expect(writeJsonSpy).toHaveBeenCalledWith(
        "/test/path/package.json",
        expect.objectContaining({
          scripts: expect.objectContaining({
            test: "jest",
            "tailor:dev": "tailor-sdk generate --watch",
            "tailor:build": "tailor-sdk generate",
            "tailor:deploy": "tailor-sdk apply",
          }),
        }),
        { spaces: 2 },
      );
    });

    it("should create tailor.config.ts", async () => {
      const writeFileSpy = vi.spyOn(fs, "writeFile");

      await addToExistingProject("/test/path", "asia-northeast", "basic");

      expect(writeFileSpy).toHaveBeenCalledWith(
        "/test/path/tailor.config.ts",
        expect.stringContaining('name: "existing-project"'),
      );
    });

    it("should create src directories", async () => {
      const ensureDirSpy = vi.spyOn(fs, "ensureDir");

      await addToExistingProject("/test/path", "asia-northeast", "basic");

      expect(ensureDirSpy).toHaveBeenCalledWith("/test/path/src/tailordb");
      expect(ensureDirSpy).toHaveBeenCalledWith("/test/path/src/resolvers");
    });
  });

  describe("initCommand interactive interface", () => {
    let mockSpawn: any;

    beforeEach(() => {
      // Reset all mocks
      vi.clearAllMocks();

      // Mock process.cwd
      vi.spyOn(process, "cwd").mockReturnValue("/test/cwd");

      // Mock fs methods
      vi.spyOn(fs, "existsSync").mockReturnValue(false);
      vi.spyOn(fs, "pathExists").mockResolvedValue(false as any);
      vi.spyOn(fs, "ensureDir").mockResolvedValue(undefined as any);
      vi.spyOn(fs, "writeJson").mockResolvedValue(undefined);
      vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);

      // Mock spawn for npm install
      mockSpawn = {
        on: vi.fn((event, callback) => {
          if (event === "exit" && callback) {
            // Simulate successful npm install
            setTimeout(() => callback(0), 10);
          }
          return mockSpawn;
        }),
      };
      (spawn as any).mockReturnValue(mockSpawn);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should skip project name prompt when provided as positional argument", async () => {
      // Mock inquirer to only expect region and template prompts
      (inquirer.prompt as any).mockResolvedValueOnce({
        region: "asia-northeast",
        template: "basic",
      });

      // Run the command with positional argument
      await initCommand.run?.({
        args: {
          _: [],
          name: "test-project",
          region: "",
          "skip-install": true,
          template: "",
          yes: false,
          "add-to-existing": false,
        },
        rawArgs: [],
        cmd: initCommand,
      } as any);

      // Verify inquirer was called with only region and template prompts
      expect(inquirer.prompt).toHaveBeenCalledOnce();
      const promptCall = (inquirer.prompt as any).mock.calls[0][0];
      const prompts = Array.isArray(promptCall) ? promptCall : [];

      // Should not include projectName prompt
      expect(
        prompts.find((p: any) => p.name === "projectName"),
      ).toBeUndefined();

      // Should include region and template prompts
      expect(prompts.find((p: any) => p.name === "region")).toBeDefined();
      expect(prompts.find((p: any) => p.name === "template")).toBeDefined();

      // Verify project was created with the provided name
      expect(vi.mocked(fs.writeJson)).toHaveBeenCalledWith(
        expect.stringContaining("test-project/package.json"),
        expect.objectContaining({ name: "test-project" }),
        expect.any(Object),
      );
    });

    it("should prompt for project name when not provided", async () => {
      // Mock inquirer to expect all prompts
      (inquirer.prompt as any).mockResolvedValueOnce({
        projectName: "prompted-project",
        region: "us-west",
        template: "fullstack",
      });

      // Run the command without positional argument
      await initCommand.run?.({
        args: {
          _: [],
          name: undefined as any,
          region: "",
          "skip-install": true,
          template: "",
          yes: false,
          "add-to-existing": false,
        },
        rawArgs: [],
        cmd: initCommand,
      } as any);

      // Verify inquirer was called with all prompts
      expect(inquirer.prompt).toHaveBeenCalledOnce();
      const promptCall = (inquirer.prompt as any).mock.calls[0][0];
      const prompts = Array.isArray(promptCall) ? promptCall : [];

      // Should include all prompts
      expect(prompts.find((p: any) => p.name === "projectName")).toBeDefined();
      expect(prompts.find((p: any) => p.name === "region")).toBeDefined();
      expect(prompts.find((p: any) => p.name === "template")).toBeDefined();

      // Verify project was created with the prompted name
      expect(vi.mocked(fs.writeJson)).toHaveBeenCalledWith(
        expect.stringContaining("prompted-project/package.json"),
        expect.objectContaining({ name: "prompted-project" }),
        expect.any(Object),
      );
    });

    it("should skip all prompts with --yes flag", async () => {
      // Run the command with --yes flag
      await initCommand.run?.({
        args: {
          _: [],
          name: "yes-project",
          region: "",
          "skip-install": true,
          template: "",
          yes: true,
          "add-to-existing": false,
        },
        rawArgs: [],
        cmd: initCommand,
      } as any);

      // Verify inquirer was not called
      expect(inquirer.prompt).not.toHaveBeenCalled();

      // Verify project was created with defaults
      expect(vi.mocked(fs.writeJson)).toHaveBeenCalledWith(
        expect.stringContaining("yes-project/package.json"),
        expect.objectContaining({ name: "yes-project" }),
        expect.any(Object),
      );

      // Verify default config values
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        expect.stringContaining("tailor.config.ts"),
        expect.stringContaining('region: "asia-northeast"'), // default region
      );
    });

    it("should require project name with --yes flag", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const processExitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(() => {
          throw new Error("Process exit");
        });

      // Run with --yes flag but no project name
      await expect(
        initCommand.run?.({
          args: {
            _: [],
            name: undefined as any,
            region: "",
            "skip-install": true,
            template: "",
            yes: true,
            "add-to-existing": false,
          },
          rawArgs: [],
          cmd: initCommand,
        } as any),
      ).rejects.toThrow("Process exit");

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Error: Project name is required when using --yes flag",
        ),
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Usage: npx @tailor-platform/tailor-sdk init <project-name> --yes",
        ),
      );

      consoleErrorSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    it("should validate project name from positional argument", async () => {
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const processExitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(() => {
          throw new Error("Process exit");
        });

      // Run with invalid project name
      await expect(
        initCommand.run?.({
          args: {
            _: [],
            name: "-invalid-name",
            region: "",
            "skip-install": true,
            template: "",
            yes: true,
            "add-to-existing": false,
          },
          rawArgs: [],
          cmd: initCommand,
        } as any),
      ).rejects.toThrow("Process exit");

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Error: Project name must start with a letter or number",
        ),
      );

      consoleErrorSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    it("should cancel when user declines to overwrite existing directory", async () => {
      // Mock process.exit
      const processExitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation((() => {}) as any);
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      // Mock existing directory (but not a project with package.json)
      vi.spyOn(fs, "existsSync").mockReturnValue(true);
      vi.spyOn(fs, "pathExists").mockResolvedValue(false as any);

      // Mock user choosing not to overwrite (which causes cancellation)
      (inquirer.prompt as any).mockResolvedValue({ overwrite: false });

      // Run the command
      await initCommand.run?.({
        args: {
          _: [],
          name: "existing-project",
          region: "",
          "skip-install": true,
          template: "",
          yes: false,
          "add-to-existing": false,
        },
        rawArgs: [],
        cmd: initCommand,
      } as any);

      // Verify prompt for overwrite
      expect(inquirer.prompt).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "confirm",
          name: "overwrite",
          message: expect.stringContaining("already exists"),
        }),
      );

      // Verify cancellation was logged
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Cancelled"),
      );

      // Verify process exit
      expect(processExitSpy).toHaveBeenCalledWith(0);

      processExitSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });

    it("should add to existing project when detected", async () => {
      // Mock current directory as existing project
      vi.spyOn(fs, "pathExists").mockImplementation(async (filePath) => {
        return filePath.toString().includes("package.json");
      });

      // Mock existing package.json
      vi.spyOn(fs, "readJson").mockResolvedValue({
        name: "existing-app",
        version: "1.0.0",
      });

      // Mock user confirming to add to existing project
      (inquirer.prompt as any).mockResolvedValueOnce({
        confirmAdd: true,
      });

      // Run without project name
      await initCommand.run?.({
        args: {
          _: [],
          name: undefined as any,
          region: "",
          "skip-install": true,
          template: "",
          yes: false,
          "add-to-existing": false,
        },
        rawArgs: [],
        cmd: initCommand,
      } as any);

      // Verify prompt for adding to existing project
      expect(inquirer.prompt).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "confirm",
          name: "confirmAdd",
          message: expect.stringContaining("Add Tailor SDK to it?"),
        }),
      );

      // Verify tailor-sdk was added to existing project
      expect(vi.mocked(fs.writeJson)).toHaveBeenCalledWith(
        expect.stringContaining("package.json"),
        expect.objectContaining({
          devDependencies: expect.objectContaining({
            "@tailor-platform/tailor-sdk": "latest",
          }),
        }),
        expect.any(Object),
      );
    });
  });
});
