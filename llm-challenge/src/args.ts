import {
  PROBLEM_GROUPS,
  SDK_PROFILES,
  type RequestedGroup,
  type RunOptions,
  type SdkProfile,
} from "./types";

const DEFAULTS: Omit<RunOptions, "output" | "problemFilters" | "profileExplicit"> = {
  sdkRef: "HEAD",
  profile: "no-docs" satisfies SdkProfile,
  group: "all" satisfies RequestedGroup,
  model: "gpt-5.5",
  effort: "xhigh",
  runs: 3,
  concurrency: 1,
  maxSeconds: 1800,
  preflight: true,
  pruneWorkspaceDeps: false,
};

export function parseRunCommand(argv: string[]): RunOptions {
  const [command, ...rest] = argv;
  if (command !== "run") {
    throw new Error("Usage: pnpm -C llm-challenge challenge run [options]");
  }
  return parseRunArgs(rest);
}

export function parseRunArgs(argv: string[]): RunOptions {
  const options: RunOptions = {
    ...DEFAULTS,
    profileExplicit: false,
    problemFilters: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const [name, inlineValue] = splitOption(token);
    if (!name.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    switch (name) {
      case "--no-preflight":
        rejectInlineValue(name, inlineValue);
        options.preflight = false;
        continue;
      case "--prune-workspace-deps":
        rejectInlineValue(name, inlineValue);
        options.pruneWorkspaceDeps = true;
        continue;
      default:
        break;
    }

    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) {
      index += 1;
    }
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${name}`);
    }

    switch (name) {
      case "--sdk-ref":
        options.sdkRef = value;
        break;
      case "--profile":
        options.profile = parseProfile(value);
        options.profileExplicit = true;
        break;
      case "--group":
        options.group = parseGroup(value);
        break;
      case "--model":
        options.model = value;
        break;
      case "--effort":
        options.effort = value;
        break;
      case "--runs":
        options.runs = parsePositiveInteger(name, value);
        break;
      case "--concurrency":
        options.concurrency = parsePositiveInteger(name, value);
        break;
      case "--problem":
        options.problemFilters.push(value);
        break;
      case "--problems": {
        const problemFilters = value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        if (problemFilters.length === 0) {
          throw new Error("--problems must contain at least one problem");
        }
        options.problemFilters.push(...problemFilters);
        break;
      }
      case "--output":
        options.output = value;
        break;
      case "--max-seconds":
        options.maxSeconds = parsePositiveInteger(name, value);
        break;
      case "--rerun-nonzero-from":
        options.rerunNonzeroFrom = value;
        break;
      default:
        throw new Error(`Unknown option: ${name}`);
    }
  }

  if (options.group === "cli" && options.profileExplicit) {
    throw new Error("--profile cannot be used with --group cli");
  }

  return options;
}

function splitOption(token: string): [string, string | undefined] {
  const equalsIndex = token.indexOf("=");
  if (equalsIndex === -1) {
    return [token, undefined];
  }
  return [token.slice(0, equalsIndex), token.slice(equalsIndex + 1)];
}

function parseProfile(value: string): SdkProfile {
  if ((SDK_PROFILES as readonly string[]).includes(value)) {
    return value as SdkProfile;
  }
  throw new Error(`Unknown profile: ${value}`);
}

function parseGroup(value: string): RequestedGroup {
  if (value === "all" || (PROBLEM_GROUPS as readonly string[]).includes(value)) {
    return value as RequestedGroup;
  }
  throw new Error(`Unknown group: ${value}`);
}

function parsePositiveInteger(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function rejectInlineValue(name: string, inlineValue: string | undefined): void {
  if (inlineValue !== undefined) {
    throw new Error(`${name} does not accept a value`);
  }
}
