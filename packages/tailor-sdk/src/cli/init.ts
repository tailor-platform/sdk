#!/usr/bin/env node

import { defineCommand } from "citty";
import inquirer from "inquirer";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import chalk from "chalk";
import { spawn } from "node:child_process";

export const validateProjectName = (name: string): boolean | string => {
  // Check if name is empty or too short
  if (!name || name.length < 2) {
    return "Project name must be at least 2 characters long";
  }

  // Check length limit
  if (name.length > 50) {
    return "Project name must be 50 characters or less";
  }

  // Check if name starts with a letter or number
  if (!/^[a-zA-Z0-9]/.test(name)) {
    return "Project name must start with a letter or number";
  }

  // Check if name ends with a letter or number (no trailing hyphens)
  if (!/[a-zA-Z0-9]$/.test(name)) {
    return "Project name must end with a letter or number";
  }

  // Check for valid characters (letters, numbers, hyphens only)
  if (!/^[a-zA-Z0-9-]+$/.test(name)) {
    return "Project name can only contain letters, numbers, and hyphens";
  }

  // Check for consecutive hyphens
  if (/--/.test(name)) {
    return "Project name cannot contain consecutive hyphens";
  }

  // Check npm naming conventions - lowercase recommended
  if (name !== name.toLowerCase()) {
    return "Project name should be lowercase (npm convention)";
  }

  return true;
};

export const generatePackageJson = (projectName: string) => ({
  name: projectName,
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

export const generateTailorConfig = (
  projectName: string,
  region: string,
  template: string,
  srcDir: string = "src",
) => {
  const baseConfig = `import { defineConfig } from "@tailor-platform/tailor-sdk";

export default defineConfig({
  name: "${projectName}",
  region: "${region}",
  app: {
    "app-name": {
      db: {
        "main-db": {
          files: [\`./${srcDir}/tailordb/**/*.ts\`]
        }
      },
      pipeline: {
        "main-pipeline": {
          files: [\`./${srcDir}/resolvers/**/resolver.ts\`]
        },
      },`;

  if (template === "fullstack") {
    return (
      baseConfig +
      `
      auth: {
        namespace: "main-auth",
        idProviderConfigs: [
          {
            Name: "local-dev",
            Config: {
              Kind: "IDToken",
              ClientID: "your-client-id",
              ProviderURL: "https://your-auth-provider.com/",
            },
          },
        ],
        userProfileProvider: "TAILORDB",
        userProfileProviderConfig: {
          Kind: "TAILORDB",
          Namespace: "main-db",
          Type: "User",
          UsernameField: "email",
          AttributesFields: ["roles"],
        },
        machineUsers: [
          {
            Name: "admin-machine-user",
            Attributes: ["admin-role-uuid"],
          },
        ],
        oauth2Clients: [],
      },` +
      `
    },
  },
  generators: [
    "@tailor/sdl",
    ["@tailor/kysely-type", { distPath: ({ tailorDB }) => \`./src/generated/\${tailorDB}.ts\` }],
    ["@tailor/db-type", { distPath: () => "./src/tailordb/types.ts" }],
  ],
});`
    );
  } else if (template === "basic") {
    return (
      baseConfig +
      `
      auth: {
        namespace: "main-auth",
      },
    },
  },
});`
    );
  }

  return (
    baseConfig +
    `
    },
  },
});`
  );
};

const gitignoreContent = `node_modules/
.tailor-sdk
.env
.env.local
.env.*.local
src/generated/
*.log
.DS_Store
`;

const tsconfigContent = (srcDir: string = "src") => ({
  compilerOptions: {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "bundler",
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    allowJs: true,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    resolveJsonModule: true,
  },
  include: [`${srcDir}/**/*`, "tailor.config.ts"],
  exclude: ["node_modules", "dist", `${srcDir}/generated`],
});

const readmeContent = (
  projectName: string,
  srcDir: string = "src",
) => `# ${projectName}

A Tailor SDK project

## Getting Started

1. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

2. Start development mode:
   \`\`\`bash
   npm run dev
   \`\`\`

## Project Structure

- \`${srcDir}/tailordb/\` - Data model definitions
- \`${srcDir}/resolvers/\` - API resolver definitions
- \`tailor.config.ts\` - Tailor configuration

## Available Scripts

- \`npm run dev\` - Start development mode with auto-reload
- \`npm run build\` - Generate production files
- \`npm run deploy\` - Deploy to Tailor platform

## Documentation

For more information, visit [Tailor Documentation](https://docs.tailor.tech)
`;

const basicTemplateFiles = (srcDir: string = "src") => ({
  [`${srcDir}/tailordb/index.ts`]: `import { db, t } from "@tailor-platform/tailor-sdk";

export const user = db.type("User", {
  name: db.string(),
  email: db.string().unique(),
  ...db.fields.timestamps(),
});

export type User = t.infer<typeof user>;
`,
  [`${srcDir}/resolvers/hello/resolver.ts`]: `import { createQueryResolver, t } from "@tailor-platform/tailor-sdk";

export default createQueryResolver(
  "hello",
  t.type({
    name: t.string(),
  })
)
  .fnStep("greet", async (context) => {
    return \`Hello, \${context.input.name}!\`;
  })
  .returns(
    (context) => ({
      message: context.greet,
    }),
    t.type({
      message: t.string(),
    })
  );
`,
});

const fullstackTemplateFiles = (srcDir: string = "src") => ({
  ...basicTemplateFiles(srcDir),
  [`${srcDir}/tailordb/user.ts`]: `import { db, t } from "@tailor-platform/tailor-sdk";

export const user = db.type("User", {
  email: db.string().unique(),
  name: db.string(),
  roles: db.string().array().optional(),
  isActive: db.bool().hooks({
    create: () => true,
  }),
  ...db.fields.timestamps(),
});

export type User = t.infer<typeof user>;
`,
});

// Check if path exists (file or directory)
async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

// Ensure directory recursively
async function ensureDir(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
}

// Read JSON file
async function readJson<T = any>(file: string): Promise<T> {
  const txt = await fsp.readFile(file, "utf-8");
  return JSON.parse(txt) as T;
}

// Write JSON file with spacing
async function writeJson(file: string, data: any, spaces = 2): Promise<void> {
  const txt = JSON.stringify(data, null, spaces);
  await fsp.writeFile(file, txt);
}

const runNpmInstall = (projectPath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["install"], {
      cwd: projectPath,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`npm install exited with code ${code}`));
      }
    });
  });
};

export const checkExistingProject = async (projectPath: string) => {
  const packageJsonPath = path.join(projectPath, "package.json");
  const tsconfigPath = path.join(projectPath, "tsconfig.json");

  return {
    hasPackageJson: await pathExists(packageJsonPath),
    hasTsConfig: await pathExists(tsconfigPath),
    packageJsonPath,
  };
};

export const addToExistingProject = async (
  projectPath: string,
  region: string,
  template: string,
  srcDir: string = "src",
) => {
  console.log(chalk.blue("\n📦 Adding Tailor SDK to existing project...\n"));

  // Read existing package.json
  const packageJsonPath = path.join(projectPath, "package.json");
  const existingPackageJson = await readJson<any>(packageJsonPath);

  // Add Tailor SDK dependencies
  if (!existingPackageJson.devDependencies) {
    existingPackageJson.devDependencies = {};
  }
  existingPackageJson.devDependencies["@tailor-platform/tailor-sdk"] = "latest";

  // Add scripts if they don't exist
  if (!existingPackageJson.scripts) {
    existingPackageJson.scripts = {};
  }
  if (!existingPackageJson.scripts["tailor:dev"]) {
    existingPackageJson.scripts["tailor:dev"] = "tailor-sdk generate --watch";
  }
  if (!existingPackageJson.scripts["tailor:build"]) {
    existingPackageJson.scripts["tailor:build"] = "tailor-sdk generate";
  }
  if (!existingPackageJson.scripts["tailor:deploy"]) {
    existingPackageJson.scripts["tailor:deploy"] = "tailor-sdk apply";
  }

  // Write updated package.json
  await writeJson(packageJsonPath, existingPackageJson, 2);
  console.log(chalk.green("✅ Updated package.json"));

  // Create tailor.config.ts
  const configPath = path.join(projectPath, "tailor.config.ts");
  if (await pathExists(configPath)) {
    console.log(chalk.yellow("⚠️  tailor.config.ts already exists, skipping"));
  } else {
    await fsp.writeFile(
      configPath,
      generateTailorConfig(
        existingPackageJson.name || "my-project",
        region,
        template,
        srcDir,
      ),
    );
    console.log(chalk.green("✅ Created tailor.config.ts"));
  }

  // Create directories and sample files
  await ensureDir(path.join(projectPath, srcDir, "tailordb"));
  await ensureDir(path.join(projectPath, srcDir, "resolvers"));

  const templateFiles =
    template === "fullstack"
      ? fullstackTemplateFiles(srcDir)
      : basicTemplateFiles(srcDir);

  for (const [filePath, content] of Object.entries(templateFiles)) {
    const fullPath = path.join(projectPath, filePath);
    if (await pathExists(fullPath)) {
      console.log(chalk.yellow(`⚠️  ${filePath} already exists, skipping`));
    } else {
      await ensureDir(path.dirname(fullPath));
      await fsp.writeFile(fullPath, content);
      console.log(chalk.green(`✅ Created ${filePath}`));
    }
  }

  // Update .gitignore if needed
  const gitignorePath = path.join(projectPath, ".gitignore");
  if (await pathExists(gitignorePath)) {
    const existingGitignore = await fsp.readFile(gitignorePath, "utf-8");
    const toAdd = [`${srcDir}/generated/`, ".tailor-sdk/"];
    const additions = toAdd.filter((item) => !existingGitignore.includes(item));
    if (additions.length > 0) {
      await fsp.appendFile(
        gitignorePath,
        "\n# Tailor SDK\n" + additions.join("\n") + "\n",
      );
      console.log(chalk.green("✅ Updated .gitignore"));
    }
  }

  return existingPackageJson;
};

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Initialize a new Tailor SDK project",
  },
  args: {
    name: {
      type: "positional",
      description: "Project name",
      required: false,
    },
    region: {
      type: "string",
      alias: "r",
      description: "Deployment region",
      default: "",
    },
    "skip-install": {
      type: "boolean",
      description: "Skip npm install",
      default: false,
    },
    template: {
      type: "string",
      alias: "t",
      description: "Template to use (basic|fullstack)",
      default: "",
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Use default values for all prompts",
      default: false,
    },
    "add-to-existing": {
      type: "boolean",
      description: "Add Tailor SDK to an existing TypeScript project",
      default: false,
    },
    "src-dir": {
      type: "string",
      alias: "s",
      description: "Source directory name (default: src)",
      default: "src",
    },
  },
  async run({ args }) {
    console.log(chalk.blue("\n🎯 Welcome to Tailor SDK!\n"));

    let projectName = args.name;
    const isAddToExisting = args["add-to-existing"];
    const srcDir = args["src-dir"] || "src";
    const currentDirPath = process.cwd();

    // Check if current directory is an existing project when no project name is provided
    let useExistingProject = isAddToExisting;
    let targetPath = currentDirPath;

    if (!projectName && !isAddToExisting && !args.yes) {
      const currentDirCheck = await checkExistingProject(currentDirPath);
      if (currentDirCheck.hasPackageJson) {
        const { confirmAdd } = await inquirer.prompt({
          type: "confirm",
          name: "confirmAdd",
          message:
            "Current directory appears to be an existing project. Add Tailor SDK to it?",
          default: true,
        });

        if (confirmAdd) {
          useExistingProject = true;
        } else {
          // Ask for project name if they don't want to add to current directory
          const { newProjectName } = await inquirer.prompt({
            type: "input",
            name: "newProjectName",
            message: "Enter name for new project:",
            validate: (input: string) => {
              const validation = validateProjectName(input);
              return validation === true ? true : validation;
            },
          });
          projectName = newProjectName;
        }
      }
    }

    // Validate and set region with type safety
    const validRegions = ["asia-northeast", "us-west"] as const;
    type Region = (typeof validRegions)[number];

    let region: Region = "asia-northeast"; // default
    if (args.region) {
      if (validRegions.includes(args.region as Region)) {
        region = args.region as Region;
      } else {
        console.error(chalk.red(`Invalid region: ${args.region}`));
        console.error(
          chalk.yellow(`Valid regions: ${validRegions.join(", ")}`),
        );
        process.exit(1);
      }
    }

    // Validate and set template with type safety
    const validTemplates = ["basic", "fullstack"] as const;
    type Template = (typeof validTemplates)[number];

    let template: Template = "basic"; // default
    if (args.template) {
      if (validTemplates.includes(args.template as Template)) {
        template = args.template as Template;
      } else {
        console.error(chalk.red(`Invalid template: ${args.template}`));
        console.error(
          chalk.yellow(`Valid templates: ${validTemplates.join(", ")}`),
        );
        process.exit(1);
      }
    }

    if (!args.yes && !useExistingProject) {
      const prompts: any[] = [];

      // Only prompt for project name if not already provided
      if (!projectName) {
        prompts.push({
          type: "input",
          name: "projectName",
          message: "Project name:",
          default: "my-tailor-app",
          validate: (input: string) => {
            const validation = validateProjectName(input);
            return validation === true ? true : validation;
          },
        });
      }

      prompts.push(
        {
          type: "list",
          name: "region",
          message: "Select deployment region:",
          choices: [
            { name: "Asia Northeast", value: "asia-northeast" },
            { name: "US West", value: "us-west" },
          ],
          default: region,
        },
        {
          type: "list",
          name: "template",
          message: "Select project template:",
          choices: [
            { name: "Basic (minimal setup)", value: "basic" },
            { name: "Fullstack (with auth)", value: "fullstack" },
          ],
          default: template,
        },
      );

      const answers = await inquirer.prompt(prompts);

      projectName = answers.projectName || projectName;
      region = answers.region;
      template = answers.template;
    } else {
      // Project name is required when using --yes flag (unless adding to existing project)
      if (!useExistingProject && !projectName) {
        console.error(
          chalk.red("Error: Project name is required when using --yes flag"),
        );
        console.error(
          chalk.yellow(
            "Usage: npx @tailor-platform/tailor-sdk init <project-name> --yes",
          ),
        );
        process.exit(1);
      }

      // Validate project name if provided
      if (projectName) {
        const validation = validateProjectName(projectName);
        if (validation !== true) {
          console.error(chalk.red(`Error: ${validation}`));
          process.exit(1);
        }
      }
    }

    // Update project path if a name was provided after initial check
    const projectPath = projectName
      ? path.resolve(currentDirPath, projectName)
      : currentDirPath;

    // Update target path based on whether we're using existing project
    if (!useExistingProject && projectName) {
      targetPath = projectPath;
    }

    // Handle existing directory/project scenarios
    if (!useExistingProject && projectName && fs.existsSync(projectPath)) {
      const projectCheck = await checkExistingProject(projectPath);

      if (projectCheck.hasPackageJson && !args.yes) {
        // Directory exists and has package.json - offer choices
        const { action } = await inquirer.prompt({
          type: "list",
          name: "action",
          message: `Directory ${projectName} already contains a package.json.`,
          choices: [
            { name: "Add Tailor SDK to existing project", value: "add" },
            { name: "Create new project (overwrite)", value: "overwrite" },
            { name: "Cancel", value: "cancel" },
          ],
        });

        if (action === "cancel") {
          console.log(chalk.yellow("Cancelled"));
          process.exit(0);
        } else if (action === "add") {
          useExistingProject = true;
          targetPath = projectPath;
        } else {
          // Confirm overwrite
          const { confirmOverwrite } = await inquirer.prompt({
            type: "confirm",
            name: "confirmOverwrite",
            message: chalk.red(
              "⚠️  This will DELETE all existing files. Are you sure?",
            ),
            default: false,
          });

          if (!confirmOverwrite) {
            console.log(chalk.yellow("Cancelled"));
            process.exit(0);
          }

          // Remove existing directory (recursive)
          await fsp.rm(projectPath, { recursive: true, force: true });
        }
      } else if (!projectCheck.hasPackageJson && !args.yes) {
        // Directory exists but no package.json
        const { overwrite } = await inquirer.prompt({
          type: "confirm",
          name: "overwrite",
          message: `Directory ${projectName} already exists. Overwrite?`,
          default: false,
        });

        if (!overwrite) {
          console.log(chalk.yellow("Cancelled"));
          process.exit(0);
        }
      } else if (args.yes) {
        console.error(
          chalk.red(`Error: Directory ${projectName} already exists`),
        );
        process.exit(1);
      }
    }

    try {
      // Handle existing project
      if (useExistingProject) {
        await addToExistingProject(targetPath, region, template, srcDir);

        if (!args["skip-install"]) {
          console.log(chalk.blue("\n📦 Installing dependencies..."));
          try {
            await runNpmInstall(targetPath);
            console.log(chalk.green("✅ Dependencies installed"));
          } catch (error) {
            console.error(
              chalk.yellow(
                "⚠️  Failed to install dependencies. You can run 'npm install' manually later.",
              ),
            );
            if (error instanceof Error) {
              console.error(chalk.gray(`Error details: ${error.message}`));
            }
          }
        }

        console.log(
          chalk.green("\n✅ Tailor SDK added to existing project!\n"),
        );
        console.log(chalk.cyan("Next steps:"));
        let step = 1;
        if (args["skip-install"]) {
          console.log(`  ${step++}. npm install`);
        }
        console.log(
          chalk.white(
            `  ${step++}. npm run tailor:dev (start development mode)`,
          ),
        );
        console.log(
          chalk.white(
            `  ${step++}. Edit ${srcDir}/tailordb/*.ts to define your data models`,
          ),
        );
        console.log(
          chalk.white(
            `  ${step++}. Edit ${srcDir}/resolvers/**/resolver.ts to create API endpoints`,
          ),
        );
        console.log(chalk.blue("\nDocumentation: https://docs.tailor.tech\n"));
        return;
      }

      // Create new project
      console.log(chalk.blue("\n📁 Creating project structure..."));

      await ensureDir(projectPath);
      await ensureDir(path.join(projectPath, srcDir, "tailordb"));
      await ensureDir(path.join(projectPath, srcDir, "resolvers"));

      await writeJson(
        path.join(projectPath, "package.json"),
        generatePackageJson(projectName),
        2,
      );

      await fsp.writeFile(
        path.join(projectPath, "tailor.config.ts"),
        generateTailorConfig(projectName, region, template, srcDir),
      );

      await fsp.writeFile(
        path.join(projectPath, ".gitignore"),
        gitignoreContent,
      );
      await fsp.writeFile(
        path.join(projectPath, "README.md"),
        readmeContent(projectName, srcDir),
      );
      await writeJson(
        path.join(projectPath, "tsconfig.json"),
        tsconfigContent(srcDir),
        2,
      );

      const templateFiles =
        template === "fullstack"
          ? fullstackTemplateFiles(srcDir)
          : basicTemplateFiles(srcDir);

      for (const [filePath, content] of Object.entries(templateFiles)) {
        const fullPath = path.join(projectPath, filePath);
        await ensureDir(path.dirname(fullPath));
        await fsp.writeFile(fullPath, content);
      }

      console.log(chalk.green("✅ Project structure created"));

      if (!args["skip-install"]) {
        console.log(chalk.blue("\n📦 Installing dependencies..."));
        try {
          await runNpmInstall(projectPath);
          console.log(chalk.green("✅ Dependencies installed"));
        } catch (error) {
          console.error(
            chalk.yellow(
              "⚠️  Failed to install dependencies. You can run 'npm install' manually later.",
            ),
          );
          if (error instanceof Error) {
            console.error(chalk.gray(`Error details: ${error.message}`));
          }
        }
      }

      console.log(chalk.green("\n✅ Project initialized successfully!\n"));
      console.log(chalk.cyan("Next steps:"));
      let step = 0;
      console.log(`  ${++step}. cd ${projectName}`);
      if (args["skip-install"]) {
        console.log(`  ${++step}. npm install`);
        console.log(`  ${++step}. npm run dev (start development mode)`);
      } else {
        console.log(`  ${++step}. npm run dev (start development mode)`);
      }
      console.log(
        `  ${++step}. Edit ${srcDir}/tailordb/*.ts to define your data models`,
      );
      console.log(
        chalk.white(
          `  ${++step}. Edit ${srcDir}/resolvers/**/resolver.ts to create API endpoints`,
        ),
      );
      console.log(chalk.blue("\nDocumentation: https://docs.tailor.tech\n"));
    } catch (error) {
      console.error(chalk.red("Error creating project:"), error);
      process.exit(1);
    }
  },
});
