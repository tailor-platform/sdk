import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { cancel, log, select, text } from "@clack/prompts";

interface Opts {
  name?: string;
  template?: string;
}

export interface Context {
  projectName: string;
  projectDir: string;
  templateName: string;
  templateDir: string;
}

const templatesDir = () => resolve(import.meta.dirname, "..", "templates");

const availableTemplates = async () => {
  const entries = await readdir(templatesDir(), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
};

const templateHints: Record<string, string | undefined> = {
  "hello-world": "Initial project to get started with Tailor Platform SDK",
  "inventory-management": "Simple inventory management system",
  "multi-application": "Multi-application setup with shared databases",
  tailordb: "Comprehensive TailorDB table definitions with all features",
  resolver: "Resolver patterns with testing (simple, DB, env, user)",
  workflow: "Workflow patterns with job chaining and testing",
  executor: "Executor trigger types (record, resolver, schedule, webhook)",
  "static-web-site": "Static website with auth and IdP integration",
  generators: "Built-in generation plugins: kysely, enums, files, seed",
};

const validateName = (name: string | undefined) => {
  if (!name) {
    return "Project name is required.";
  }
  if (name.length < 3 || name.length > 30) {
    return "Project name must be between 3 and 30 characters long.";
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    return "Project name can only contain lowercase letters, numbers, and hyphens.";
  }
  if (name.startsWith("-") || name.endsWith("-")) {
    return "Project name cannot start or end with a hyphen.";
  }
  if (existsSync(resolve(name))) {
    return `Directory "${name}" already exists. Please choose a different project name.`;
  }
  return undefined;
};

const validateTemplate = async (template: string) => {
  const availables = await availableTemplates();
  if (!availables.includes(template)) {
    return `Template "${template}" is not available. Available templates are: ${availables.join(", ")}.`;
  }
  return undefined;
};

const unwrapPromptResult = <T>(value: T | symbol) => {
  if (typeof value === "symbol") {
    cancel("Operation cancelled");
    process.exit(0);
  }
  return value;
};

const requireValue = (value: string | undefined, message: string) => {
  if (!value) {
    throw new Error(message);
  }
  return value;
};

export const collectContext = async (opts: Opts): Promise<Context> => {
  let { name, template } = opts;
  if (name) {
    const err = validateName(name);
    if (err) {
      log.error(`Invalid project name: ${err}`);
      process.exit(1);
    }
  }

  if (template) {
    const err = await validateTemplate(template);
    if (err) {
      log.error(`Invalid template: ${err}`);
      process.exit(1);
    }
  }

  if (!name) {
    name = unwrapPromptResult(
      await text({
        message: "📝 What's your project name?",
        validate: validateName,
      }),
    );
  } else {
    log.info(`📦 Project: ${name}`);
  }

  if (!template) {
    const options = (await availableTemplates()).map((value) => ({
      value,
      hint: templateHints[value],
    }));
    template = unwrapPromptResult(
      await select({
        message: "🎨 Choose your template",
        options,
      }),
    );
  } else {
    log.info(`🎯 Template: ${template}`);
  }

  const projectName = requireValue(name, "Project name is required.");
  const templateName = requireValue(template, "Template is required.");

  return {
    projectName,
    projectDir: resolve(projectName),
    templateName,
    templateDir: resolve(templatesDir(), templateName),
  };
};
