import { parseSync } from "oxc-parser";
import type { Plugin } from "rolldown";

type Node = {
  type?: string;
  [key: string]: unknown;
  span?: { start: number };
  start?: number;
};

const PURE_HELPERS = new Set(["defineConfig", "defineGenerators", "definePlugins"]);

function getHelperName(callee: Node | undefined): string | null {
  if (!callee || typeof callee !== "object") {
    return null;
  }

  if (callee.type === "Identifier" && typeof callee.name === "string") {
    return callee.name;
  }

  if (
    callee.type === "MemberExpression" &&
    callee.computed !== true &&
    typeof callee.property === "object" &&
    callee.property !== null &&
    (callee.property as Node).type === "Identifier" &&
    typeof (callee.property as Node).name === "string"
  ) {
    return (callee.property as Node).name as string;
  }

  return null;
}

function collectDefinePluginsCalls(node: unknown, positions: number[]): void {
  if (!node || typeof node !== "object") {
    return;
  }

  const current = node as Node;
  if (current.type === "CallExpression") {
    const call = current as Node & { callee?: Node };
    const helperName = getHelperName(call.callee);
    if (helperName && PURE_HELPERS.has(helperName)) {
      const start = typeof call.start === "number" ? call.start : call.span?.start;
      if (typeof start === "number") {
        positions.push(start);
      }
    }
  }

  for (const value of Object.values(current)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectDefinePluginsCalls(item, positions);
      }
      continue;
    }

    if (value && typeof value === "object" && "type" in value) {
      collectDefinePluginsCalls(value, positions);
    }
  }
}

function hasPureAnnotation(code: string, position: number): boolean {
  const prefix = code.slice(0, position);
  return /\/\*#__PURE__\*\/\s*$/.test(prefix);
}

/**
 * Injects __PURE__ annotations before config helper calls so unused configs
 * can be tree-shaken out of resolver/executor/workflow bundles.
 * @returns Rolldown plugin that annotates config helper calls as pure.
 */
export function createDefinePluginsPurePlugin(): Plugin {
  return {
    name: "pure-define-plugins",
    transform: {
      filter: {
        id: {
          include: [/\.ts$/, /\.js$/],
        },
      },
      handler(code, id) {
        if (
          !code.includes("definePlugins") &&
          !code.includes("defineGenerators") &&
          !code.includes("defineConfig")
        ) {
          return null;
        }

        let program: Node;
        try {
          program = parseSync(id, code).program as unknown as Node;
        } catch {
          return null;
        }

        const positions: number[] = [];
        collectDefinePluginsCalls(program, positions);
        if (positions.length === 0) {
          return null;
        }

        positions.sort((a, b) => b - a);
        let transformed = code;
        for (const position of positions) {
          if (hasPureAnnotation(transformed, position)) {
            continue;
          }
          transformed =
            transformed.slice(0, position) + "/*#__PURE__*/ " + transformed.slice(position);
        }

        return { code: transformed };
      },
    },
  };
}
