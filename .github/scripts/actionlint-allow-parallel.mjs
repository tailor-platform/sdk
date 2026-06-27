import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const result = spawnSync("actionlint", ["-format", "{{json .}}"], {
  encoding: "utf8",
});

if (result.status === 0) {
  process.exit(0);
}

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

let diagnostics;
try {
  diagnostics = JSON.parse(result.stdout);
} catch {
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const isParallelSyntaxDiagnostic = (diagnostic) => {
  if (
    diagnostic.kind !== "syntax-check" ||
    diagnostic.message !==
      'step must run script with "run" section or run action with "uses" section' ||
    !diagnostic.filepath ||
    !Number.isInteger(diagnostic.line)
  ) {
    return false;
  }

  const line = readFileSync(diagnostic.filepath, "utf8").split(/\r?\n/u)[diagnostic.line - 1];
  return line?.trim() === "- parallel:";
};

const remaining = diagnostics.filter((diagnostic) => !isParallelSyntaxDiagnostic(diagnostic));
const ignoredCount = diagnostics.length - remaining.length;

if (ignoredCount > 0) {
  console.error(
    `actionlint: ignored ${ignoredCount} diagnostic(s) for GitHub's step-level parallel syntax`,
  );
}

if (remaining.length === 0) {
  process.exit(0);
}

for (const diagnostic of remaining) {
  console.error(
    `${diagnostic.filepath}:${diagnostic.line}:${diagnostic.column}: ${diagnostic.message} [${diagnostic.kind}]`,
  );
  if (diagnostic.snippet) {
    console.error(diagnostic.snippet);
  }
}

process.exit(1);
