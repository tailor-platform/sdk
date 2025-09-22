import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import * as path from "node:path";
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

// Mocks for Node FS modules used by init.ts implementation
const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
}));
const fspMock = vi.hoisted(() => ({
  access: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  appendFile: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn(),
}));
vi.mock("node:fs", () => fsMock);
vi.mock("node:fs/promises", () => fspMock);
// Mock inquirer
vi.mock("inquirer");
// Mock child_process
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

describe("init command", () => {
  afterEach(() => {
    vi.clearAllMocks();
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
      expect(config).not.toContain("auth:");
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
      expect(config).toContain("auth:");
      expect(config).toContain("idProviderConfigs:");
      expect(config).toContain('userProfileProvider: "TAILORDB"');
      expect(config).toContain("generators:");
    });

    it("should use custom source directory", () => {
      const config = generateTailorConfig(
        "test-project",
        "asia-northeast",
        "basic",
        "app",
      );

      expect(config).toContain("./app/tailordb/**/*.ts");
      expect(config).toContain("./app/resolvers/**/resolver.ts");
    });
  });

  describe("checkExistingProject", () => {
    it("should detect existing project with package.json", async () => {
      const accessSpy = fspMock.access.mockImplementation(
        async (filePath: string) => {
          if (filePath.toString().includes("package.json")) return;
          throw new Error("not found");
        },
      );

      const result = await checkExistingProject("/test/path");

      expect(result.hasPackageJson).toBe(true);
      expect(result.packageJsonPath).toBe(
        path.join("/test/path", "package.json"),
      );
      expect(accessSpy).toHaveBeenCalledWith(
        path.join("/test/path", "package.json"),
      );
    });

    it("should detect project without package.json", async () => {
      fspMock.access.mockRejectedValue(new Error("not found"));

      const result = await checkExistingProject("/test/path");

      expect(result.hasPackageJson).toBe(false);
    });
  });

  describe("addToExistingProject", () => {
    beforeEach(() => {
      fspMock.readFile.mockResolvedValue(
        JSON.stringify({
          name: "existing-project",
          version: "1.0.0",
          scripts: {
            test: "jest",
          },
          dependencies: {
            express: "^4.0.0",
          },
        }),
      );
      fspMock.writeFile.mockResolvedValue(undefined as never);
      fspMock.mkdir.mockResolvedValue(undefined as never);
    });

    it("should add tailor-sdk to dependencies", async () => {
      const writeFileSpy = fspMock.writeFile;

      await addToExistingProject("/test/path", "asia-northeast", "basic");

      const pkgWrite = writeFileSpy.mock.calls.find(
        ([fp]) => fp === "/test/path/package.json",
      );
      expect(pkgWrite).toBeDefined();
      const [, content] = pkgWrite!;
      const json = JSON.parse(String(content));
      expect(json.dependencies).toEqual(
        expect.objectContaining({ express: "^4.0.0" }),
      );
      expect(json.devDependencies).toEqual(
        expect.objectContaining({ "@tailor-platform/tailor-sdk": "latest" }),
      );
    });

    it("should add tailor scripts to package.json", async () => {
      const writeFileSpy = fspMock.writeFile;

      await addToExistingProject("/test/path", "asia-northeast", "basic");

      const pkgWrite = writeFileSpy.mock.calls.find(
        ([fp]) => fp === "/test/path/package.json",
      );
      expect(pkgWrite).toBeDefined();
      const [, content] = pkgWrite!;
      const json = JSON.parse(String(content));
      expect(json.scripts).toEqual(
        expect.objectContaining({
          test: "jest",
          "tailor:dev": "tailor-sdk generate --watch",
          "tailor:build": "tailor-sdk generate",
          "tailor:deploy": "tailor-sdk apply",
        }),
      );
    });

    it("should create tailor.config.ts", async () => {
      const writeFileSpy = fspMock.writeFile;

      await addToExistingProject("/test/path", "asia-northeast", "basic");

      const confWrite = writeFileSpy.mock.calls.find(
        ([fp]) => fp === "/test/path/tailor.config.ts",
      );
      expect(confWrite?.[1]).toEqual(
        expect.stringContaining('name: "existing-project"'),
      );
    });

    it("should create src directories", async () => {
      const mkdirSpy = fspMock.mkdir;

      await addToExistingProject("/test/path", "asia-northeast", "basic");

      expect(mkdirSpy).toHaveBeenCalledWith("/test/path/src/tailordb", {
        recursive: true,
      });
      expect(mkdirSpy).toHaveBeenCalledWith("/test/path/src/resolvers", {
        recursive: true,
      });
    });

    it("should create custom source directories", async () => {
      const mkdirSpy = fspMock.mkdir;

      await addToExistingProject(
        "/test/path",
        "asia-northeast",
        "basic",
        "app",
      );

      expect(mkdirSpy).toHaveBeenCalledWith("/test/path/app/tailordb", {
        recursive: true,
      });
      expect(mkdirSpy).toHaveBeenCalledWith("/test/path/app/resolvers", {
        recursive: true,
      });
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
      fsMock.existsSync.mockReturnValue(false as never);
      fspMock.access.mockRejectedValue(new Error("not found"));
      fspMock.mkdir.mockResolvedValue(undefined as any);
      fspMock.writeFile.mockResolvedValue(undefined as never);

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
          "src-dir": "src",
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
      const pkgWrite = fspMock.writeFile.mock.calls.find(([p]) =>
        String(p).includes("test-project/package.json"),
      );
      expect(pkgWrite).toBeDefined();
      const json = JSON.parse(String(pkgWrite?.[1]));
      expect(json).toEqual(expect.objectContaining({ name: "test-project" }));
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
          "src-dir": "src",
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
      const pkgWrite2 = fspMock.writeFile.mock.calls.find(([p]) =>
        String(p).includes("prompted-project/package.json"),
      );
      const json2 = JSON.parse(String(pkgWrite2?.[1]));
      expect(json2).toEqual(
        expect.objectContaining({ name: "prompted-project" }),
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
          "src-dir": "src",
        },
        rawArgs: [],
        cmd: initCommand,
      } as any);

      // Verify inquirer was not called
      expect(inquirer.prompt).not.toHaveBeenCalled();

      // Verify project was created with defaults
      const pkgWrite3 = fspMock.writeFile.mock.calls.find(([p]) =>
        String(p).includes("yes-project/package.json"),
      );
      const json3 = JSON.parse(String(pkgWrite3?.[1]));
      expect(json3).toEqual(expect.objectContaining({ name: "yes-project" }));

      // Verify default config values
      const cfgCall = fspMock.writeFile.mock.calls.find(([p]) =>
        String(p).includes("tailor.config.ts"),
      );
      expect(cfgCall?.[1]).toEqual(
        expect.stringContaining('region: "asia-northeast"'),
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
      fsMock.existsSync.mockReturnValue(true as never);
      fspMock.access.mockRejectedValue(new Error("not found"));

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
          "src-dir": "src",
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
      fspMock.access.mockImplementation(async (filePath) => {
        if (filePath.toString().includes("package.json")) return;
        throw new Error("not found");
      });

      // Mock existing package.json
      fspMock.readFile.mockResolvedValue(
        JSON.stringify({
          name: "existing-app",
          version: "1.0.0",
        }),
      );

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
          "src-dir": "src",
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
      const pkgWrite4 = fspMock.writeFile.mock.calls.find(([p]) =>
        String(p).endsWith("package.json"),
      );
      const json4 = JSON.parse(String(pkgWrite4?.[1]));
      expect(json4.devDependencies).toEqual(
        expect.objectContaining({ "@tailor-platform/tailor-sdk": "latest" }),
      );
    });
  });
});
