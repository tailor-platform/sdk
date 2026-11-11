import {
  isArrayLiteralExpression,
  isArrowFunction,
  isBlock,
  isCallExpression,
  isIdentifier,
  isNumericLiteral,
  isPropertyAccessExpression,
  isStringLiteral,
  type Node,
  type SourceFile,
} from "typescript/ast";
import { API } from "typescript/sync";

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

const parseBench = <T>(source: string, extract: (file: SourceFile) => T): T => {
  const api = new API();
  try {
    using retained = api.createSourceFile("bench.ts", source);
    return extract(retained.sourceFile);
  } finally {
    api.close();
  }
};

export const extractBenchSources = (source: string): Record<string, string> =>
  parseBench(source, (file) => collectBenchSources(file, source));

const collectBenchSources = (file: SourceFile, source: string): Record<string, string> => {
  const sources: Record<string, string> = {};
  const visit = (node: Node): void => {
    if (
      isCallExpression(node) &&
      isIdentifier(node.expression) &&
      node.expression.text === "bench"
    ) {
      const [title, callback] = node.arguments;
      if (title && isStringLiteral(title) && callback && isArrowFunction(callback)) {
        const body = callback.body;
        const first = isBlock(body) ? body.statements.at(0) : undefined;
        const last = isBlock(body) ? body.statements.at(-1) : undefined;
        if (first && last) {
          const indent = file.getLineAndCharacterOfPosition(first.getStart(file)).character;
          sources[title.text] = dedent(source.slice(first.getStart(file), last.end), indent);
        } else if (!isBlock(body)) {
          sources[title.text] = body.getText(file);
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(file);
  return sources;
};

export const extractBaselines = (source: string): Record<string, number> =>
  parseBench(source, collectBaselines);

const collectBaselines = (file: SourceFile): Record<string, number> => {
  const baselines: Record<string, number> = {};
  const visit = (node: Node): void => {
    if (
      isCallExpression(node) &&
      isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "types" &&
      isCallExpression(node.expression.expression) &&
      isIdentifier(node.expression.expression.expression) &&
      node.expression.expression.expression.text === "bench"
    ) {
      const [title] = node.expression.expression.arguments;
      const [snapshot] = node.arguments;
      const count = snapshot && isArrayLiteralExpression(snapshot) && snapshot.elements[0];
      if (title && isStringLiteral(title) && count && isNumericLiteral(count)) {
        baselines[title.text] = Number(count.text);
      }
    }
    node.forEachChild(visit);
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
    "",
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
