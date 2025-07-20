import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import {
  validateProjectName,
  generatePackageJson,
  generateTailorConfig,
  checkExistingProject,
  addToExistingProject,
} from "./init";

// Mock fs-extra
vi.mock("fs-extra");

describe("init command", () => {
  beforeEach(() => {
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
        scripts: {
          dev: "tailor-sdk generate --watch",
          build: "tailor-sdk generate",
          deploy: "tailor-sdk apply",
        },
        dependencies: {
          "@tailor-platform/tailor-sdk": "latest",
        },
        devDependencies: {
          typescript: "^5.0.0",
          "@types/node": "^20.0.0",
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
      vi.mocked(fs.pathExists).mockImplementation(async (filePath) => {
        return filePath.toString().includes("package.json");
      });

      const result = await checkExistingProject("/test/path");

      expect(result.hasPackageJson).toBe(true);
      expect(result.packageJsonPath).toBe(
        path.join("/test/path", "package.json"),
      );
    });

    it("should detect project without package.json", async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(false as any);

      const result = await checkExistingProject("/test/path");

      expect(result.hasPackageJson).toBe(false);
    });
  });

  describe("addToExistingProject", () => {
    const mockPackageJson = {
      name: "existing-project",
      version: "1.0.0",
      scripts: {
        test: "jest",
      },
      dependencies: {
        express: "^4.0.0",
      },
    };

    beforeEach(() => {
      vi.mocked(fs.readJson).mockResolvedValue(mockPackageJson);
      vi.mocked(fs.writeJson).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.ensureDir).mockResolvedValue(undefined as any);
      vi.mocked(fs.pathExists).mockResolvedValue(false as any);
      vi.mocked(fs.readFile).mockResolvedValue("" as any);
      vi.mocked(fs.appendFile).mockResolvedValue(undefined);
    });

    it("should add tailor-sdk to dependencies", async () => {
      await addToExistingProject("/test/path", "asia-northeast", "basic");

      expect(vi.mocked(fs.writeJson)).toHaveBeenCalledWith(
        "/test/path/package.json",
        expect.objectContaining({
          dependencies: expect.objectContaining({
            "@tailor-platform/tailor-sdk": "latest",
            express: "^4.0.0",
          }),
        }),
        { spaces: 2 },
      );
    });

    it("should add tailor scripts to package.json", async () => {
      await addToExistingProject("/test/path", "asia-northeast", "basic");

      expect(vi.mocked(fs.writeJson)).toHaveBeenCalledWith(
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
      await addToExistingProject("/test/path", "asia-northeast", "basic");

      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        "/test/path/tailor.config.ts",
        expect.stringContaining('name: "existing-project"'),
      );
    });

    it("should create src directories", async () => {
      await addToExistingProject("/test/path", "asia-northeast", "basic");

      expect(vi.mocked(fs.ensureDir)).toHaveBeenCalledWith(
        "/test/path/src/tailordb",
      );
      expect(vi.mocked(fs.ensureDir)).toHaveBeenCalledWith(
        "/test/path/src/resolvers",
      );
    });
  });
});
