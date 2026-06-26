import { pathToFileURL } from "node:url";
import { writeErdDiff } from "./diff-command";

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

export function runPreviewDiffCli(args: string[]): void {
  const options = parseArgs(args);
  writeErdDiff(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPreviewDiffCli(process.argv.slice(2));
}
