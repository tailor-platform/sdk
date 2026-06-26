import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { buildErdSchemaDiff, extractEmbeddedErdSchema, renderErdDiffHtml } from "./diff";

interface PreviewDiffCliOptions {
  baseHtml: string;
  headHtml: string;
  outputHtml: string;
  outputJson?: string;
}

function readRequiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parseArgs(args: string[]): PreviewDiffCliOptions {
  const options: Partial<PreviewDiffCliOptions> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--base-html":
        options.baseHtml = readRequiredValue(args, index, arg);
        index += 1;
        break;
      case "--head-html":
        options.headHtml = readRequiredValue(args, index, arg);
        index += 1;
        break;
      case "--output-html":
        options.outputHtml = readRequiredValue(args, index, arg);
        index += 1;
        break;
      case "--output-json":
        options.outputJson = readRequiredValue(args, index, arg);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${String(arg)}`);
    }
  }

  if (!options.baseHtml) throw new Error("Missing --base-html");
  if (!options.headHtml) throw new Error("Missing --head-html");
  if (!options.outputHtml) throw new Error("Missing --output-html");

  return options as PreviewDiffCliOptions;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

export function runPreviewDiffCli(args: string[]): void {
  const options = parseArgs(args);
  const base = extractEmbeddedErdSchema(fs.readFileSync(options.baseHtml, "utf8"));
  const head = extractEmbeddedErdSchema(fs.readFileSync(options.headHtml, "utf8"));
  const diff = buildErdSchemaDiff({ base, head });

  writeFile(options.outputHtml, renderErdDiffHtml(diff));
  if (options.outputJson) {
    writeFile(options.outputJson, `${JSON.stringify(diff, null, 2)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPreviewDiffCli(process.argv.slice(2));
}
