import ts from "typescript";

export type BenchResult = {
  name: string;
  instantiations: number;
  baseline: number;
};

export const parseBenchOutput = (stdout: string): BenchResult[] => {
  const results: BenchResult[] = [];
  let name: string | undefined;
  let instantiations: number | undefined;
  for (const line of stdout.split("\n")) {
    const nameMatch = /^🏌\S*\s+(.+)$/u.exec(line);
    if (nameMatch) {
      name = nameMatch[1];
      continue;
    }
    const resultMatch = /^⛳\s+Result: (\d+) instantiations$/u.exec(line);
    if (resultMatch) {
      instantiations = Number(resultMatch[1]);
      continue;
    }
    const baselineMatch = /^🎯\s+Baseline: (\d+) instantiations$/u.exec(line);
    if (baselineMatch && name !== undefined && instantiations !== undefined) {
      results.push({ name, instantiations, baseline: Number(baselineMatch[1]) });
    }
  }
  return results;
};

const dedent = (text: string, indent: number): string =>
  text
    .split("\n")
    .map((line, index) => (index === 0 ? line : line.slice(Math.min(indent, line.search(/\S|$/)))))
    .join("\n");

export const extractBenchSources = (source: string): Record<string, string> => {
  const file = ts.createSourceFile("bench.ts", source, ts.ScriptTarget.Latest, true);
  const sources: Record<string, string> = {};
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "bench"
    ) {
      const [title, callback] = node.arguments;
      if (title && ts.isStringLiteral(title) && callback && ts.isArrowFunction(callback)) {
        const body = callback.body;
        const first = ts.isBlock(body) ? body.statements.at(0) : undefined;
        const last = ts.isBlock(body) ? body.statements.at(-1) : undefined;
        if (first && last) {
          const indent = file.getLineAndCharacterOfPosition(first.getStart(file)).character;
          sources[title.text] = dedent(source.slice(first.getStart(file), last.end), indent);
        } else if (!ts.isBlock(body)) {
          sources[title.text] = body.getText(file);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return sources;
};

export const compareToBase = (results: BenchResult[], base: BenchResult[]): BenchResult[] => {
  const measuredAny = base.some(({ instantiations }) => instantiations > 0);
  const measured = new Map(base.map(({ name, instantiations }) => [name, instantiations]));
  return results.map((result) => ({
    ...result,
    baseline: (measuredAny ? measured.get(result.name) : undefined) ?? result.instantiations,
  }));
};

const percentChange = ({ instantiations, baseline }: BenchResult): number =>
  baseline === 0 ? Infinity : ((instantiations - baseline) / baseline) * 100;

const signed = (value: number, text: string): string => `${value > 0 ? "+" : ""}${text}`;

const formatPercent = (result: BenchResult): string => {
  const percent = percentChange(result);
  if (!Number.isFinite(percent)) return "n/a";
  return signed(percent, `${percent.toFixed(2)}%`);
};

const magnitude = (result: BenchResult): number => {
  const percent = percentChange(result);
  return Number.isFinite(percent) ? Math.abs(percent) : Number.MAX_VALUE;
};

export const renderChanges = (results: BenchResult[], sources: Record<string, string>): string => {
  const changed = results
    .filter(({ instantiations, baseline }) => instantiations !== baseline)
    .toSorted((a, b) => magnitude(b) - magnitude(a));
  if (changed.length === 0) return "";

  const rows = changed.map((result) => {
    const count = result.instantiations - result.baseline;
    return `| ${count > 0 ? "🔺" : "🔻"} | ${result.name} | ${result.baseline} | ${result.instantiations} | **${formatPercent(result)}** (${signed(count, String(count))}) |`;
  });
  const details = changed.flatMap(({ name }) => {
    const code = sources[name];
    if (code === undefined) return [];
    return [`<details open><summary>${name}</summary>\n\n\`\`\`ts\n${code}\n\`\`\`\n\n</details>`];
  });
  return [
    `### Type instantiations changed in ${changed.length} ${changed.length === 1 ? "case" : "cases"}`,
    "",
    "| | Case | Base | Now | Change |",
    "|---|------|-----:|----:|-------:|",
    ...rows,
    "",
    ...details,
  ].join("\n");
};

export const toOctocovMetrics = (results: BenchResult[]) => ({
  key: "attest-type-performance",
  name: "Type Performance (attest instantiations)",
  metrics: results.map(({ name, instantiations }) => ({
    key: name,
    name,
    value: instantiations,
    unit: "",
  })),
});
