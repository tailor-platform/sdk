import ts from "typescript";

export type BenchResult = {
  name: string;
  instantiations: number;
  baseline: number;
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

export const extractBaselines = (source: string): Record<string, number> => {
  const file = ts.createSourceFile("bench.ts", source, ts.ScriptTarget.Latest, true);
  const baselines: Record<string, number> = {};
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "types" &&
      ts.isCallExpression(node.expression.expression) &&
      ts.isIdentifier(node.expression.expression.expression) &&
      node.expression.expression.expression.text === "bench"
    ) {
      const [title] = node.expression.expression.arguments;
      const [snapshot] = node.arguments;
      const count = snapshot && ts.isArrayLiteralExpression(snapshot) && snapshot.elements[0];
      if (title && ts.isStringLiteral(title) && count && ts.isNumericLiteral(count)) {
        baselines[title.text] = Number(count.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return baselines;
};

export const compareToBase = (
  current: Record<string, number>,
  base: Record<string, number>,
): BenchResult[] => {
  const baseMeasured = Object.values(base).some((count) => count > 0);
  return Object.entries(current).map(([name, instantiations]) => ({
    name,
    instantiations,
    baseline: (baseMeasured ? base[name] : undefined) ?? instantiations,
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

export const renderChanges = (results: BenchResult[], sources: Record<string, string>): string => {
  const changed = results.filter(({ instantiations, baseline }) => instantiations !== baseline);
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

export const toOctocovMetrics = (current: Record<string, number>) => ({
  key: "type-performance",
  name: "Type Performance (instantiations)",
  metrics: Object.entries(current).map(([name, value]) => ({
    key: name,
    name,
    value,
    unit: "",
  })),
});
