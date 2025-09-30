import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { cancel, isCancel, log, select, text } from "@clack/prompts";

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
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
};

const templateHints: Record<string, string | undefined> = {
  "hello-world": "Initial project to get started with Tailor SDK",
  "inventory-management": "Simple inventory management system",
};

const validateName = (name: string) => {
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
};

const validateTemplate = async (template: string) => {
  const availables = await availableTemplates();
  if (!availables.includes(template)) {
    return `Template "${template}" is not available. Available templates are: ${availables.join(", ")}.`;
  }
};

export const collectContext = async ({
  name,
  template,
}: Opts): Promise<Context> => {
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
    const ret = await text({
      message: "📝 What's your project name?",
      validate: validateName,
    });
    if (isCancel(ret)) {
      cancel("Operation cancelled");
      process.exit(0);
    }
    name = ret;
  } else {
    log.info(`📦 Project: ${name}`);
  }

  if (!template) {
    const options = (await availableTemplates()).map((value) => ({
      value,
      hint: templateHints[value],
    }));
    const ret = await select({
      message: "🎨 Choose your template",
      options,
    });
    if (isCancel(ret)) {
      cancel("Operation cancelled");
      process.exit(0);
    }
    template = ret;
  } else {
    log.info(`🎯 Template: ${template}`);
  }

  return {
    projectName: name,
    projectDir: resolve(name),
    templateName: template,
    templateDir: resolve(templatesDir(), template),
  };
};
