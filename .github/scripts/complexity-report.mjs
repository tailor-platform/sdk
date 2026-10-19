import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const MAX_ROWS = 30;

const { values: args } = parseArgs({
  options: {
    base: { type: "string" },
    head: { type: "string" },
    renames: { type: "string" },
    out: { type: "string" },
  },
});
if (!args.base || !args.head || !args.out) {
  throw new Error("--base, --head, and --out are required.");
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const renames = args.renames ? parseRenames(readFileSync(args.renames, "utf8")) : new Map();
writeFileSync(args.out, renderChanges(readJson(args.base), readJson(args.head), renames));

function parseRenames(nameStatus) {
  return new Map(
    nameStatus
      .split("\n")
      .map((line) => line.split("\t"))
      .filter(([status]) => status.startsWith("R"))
      .map(([, from, to]) => [from, to]),
  );
}

function groupFunctions(report, renames = new Map()) {
  const groups = new Map();
  const visit = (path, ancestors, functions) => {
    for (const fn of functions) {
      const names = [...ancestors, fn.name];
      const key = JSON.stringify([path, names]);
      const group = groups.get(key) ?? {
        path,
        name: names.join(" > "),
        line: fn.line,
        count: 0,
        cognitive: 0,
        cyclomatic: 0,
      };
      group.count += 1;
      group.cognitive += fn.cognitive;
      group.cyclomatic += fn.cyclomatic;
      groups.set(key, group);
      visit(path, names, fn.children ?? []);
    }
  };
  for (const file of report.files) visit(renames.get(file.path) ?? file.path, [], file.functions);
  return groups;
}

function compareGroups(base, head) {
  return [...new Set([...base.keys(), ...head.keys()])].map((key) => {
    const before = base.get(key);
    const after = head.get(key);
    const delta = {
      cognitive: (after?.cognitive ?? 0) - (before?.cognitive ?? 0),
      cyclomatic: (after?.cyclomatic ?? 0) - (before?.cyclomatic ?? 0),
    };
    return { before, after, delta };
  });
}

// An added or removed function is listed only when it has cognitive complexity.
function isReported({ before, after, delta }) {
  return delta.cognitive !== 0 || (before && after && delta.cyclomatic !== 0);
}

function renderChanges(baseReport, headReport, renames) {
  const comparisons = compareGroups(
    groupFunctions(baseReport, renames),
    groupFunctions(headReport),
  );
  const rows = comparisons
    .filter(isReported)
    .toSorted(
      (a, b) =>
        Math.abs(b.delta.cognitive) - Math.abs(a.delta.cognitive) ||
        Math.abs(b.delta.cyclomatic) - Math.abs(a.delta.cyclomatic) ||
        subjectOf(a).path.localeCompare(subjectOf(b).path) ||
        subjectOf(a).name.localeCompare(subjectOf(b).name),
    );
  const lines = renderParseErrorWarning(headReport.summary);
  if (rows.length === 0) return lines.join("\n");

  const total = (metric) => signed(comparisons.reduce((sum, { delta }) => sum + delta[metric], 0));
  lines.push(
    "<details>",
    `<summary>Complexity change of this pull request: cognitive ${total("cognitive")}, cyclomatic ${total("cyclomatic")}</summary>`,
    "",
    "| Function | File | Cognitive | Cyclomatic |",
    "| :-- | :-- | --: | --: |",
    ...rows.slice(0, MAX_ROWS).map(renderRow),
    "",
  );
  if (rows.length > MAX_ROWS) lines.push(`…and ${rows.length - MAX_ROWS} more.`, "");
  lines.push("Compared with the base commit of this pull request.", "", "</details>", "");
  return lines.join("\n");
}

function renderParseErrorWarning({ parse_error_files: files = [] }) {
  if (files.length === 0) return [];
  const list = files.map((file) => `<code>${escape(file)}</code>`).join(", ");
  return [
    `**Warning:** cccc could not fully parse ${files.length} file${files.length === 1 ? "" : "s"}: ${list}`,
    "",
  ];
}

function subjectOf({ before, after }) {
  return after ?? before;
}

function renderRow(comparison) {
  const { before, after, delta } = comparison;
  const subject = subjectOf(comparison);
  const count = subject.count > 1 ? ` ×${subject.count}` : "";
  const status = !before ? " (new)" : !after ? " (removed)" : "";
  const value = (metric) =>
    `${before?.[metric] ?? "–"} → ${after?.[metric] ?? "–"} (${signed(delta[metric])})`;
  return `| <code>${escape(subject.name)}</code>${count}${status} | <code>${escape(`${subject.path}:${subject.line}`)}</code> | ${value("cognitive")} | ${value("cyclomatic")} |`;
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

function escape(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;");
}
