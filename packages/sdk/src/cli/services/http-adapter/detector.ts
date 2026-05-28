import {
  type ASTNode,
  isStringLiteral,
  isFunctionExpression,
  findProperty,
} from "@/cli/services/workflow/ast-utils";
import {
  collectSdkBindings,
  isSdkFunctionCall,
} from "@/cli/services/workflow/sdk-binding-collector";
import type {
  Program,
  CallExpression,
  ObjectExpression,
  ArrowFunctionExpression,
  Function as FunctionExpression,
} from "@oxc-project/types";

export interface HttpAdapterLocation {
  name: string;
  sourceFile: string;
  hasOutput: boolean;
}

export interface HttpAdapterDetectionError {
  sourceFile: string;
  message: string;
}

export interface HttpAdapterDetectionResult {
  adapters: HttpAdapterLocation[];
  errors: HttpAdapterDetectionError[];
}

/**
 * Find the single defineHttpAdapter call in a source file.
 *
 * By convention, an HTTP adapter file contains exactly one default export of
 * `defineHttpAdapter({...})`. Multiple calls within one file produce an error.
 * The `name` property must be a string literal so it can be statically resolved.
 * `input` (required) and `output` (optional) must be non-async function expressions.
 * @param program - Parsed TypeScript program
 * @param sourceFile - Absolute path of the source file
 * @returns Detection result for the file
 */
export function findHttpAdaptersInFile(
  program: Program,
  sourceFile: string,
): HttpAdapterDetectionResult {
  const adapters: HttpAdapterLocation[] = [];
  const errors: HttpAdapterDetectionError[] = [];
  const bindings = collectSdkBindings(program, "defineHttpAdapter");

  function walk(node: ASTNode | null | undefined): void {
    if (!node || typeof node !== "object") return;

    if (isSdkFunctionCall(node, bindings, "defineHttpAdapter")) {
      const callExpr = node as unknown as CallExpression;
      const args = callExpr.arguments;
      if (!args || args.length < 1 || args[0]?.type !== "ObjectExpression") {
        errors.push({
          sourceFile,
          message: "defineHttpAdapter requires an object literal as its sole argument",
        });
        return;
      }
      const configObj = args[0] as ObjectExpression;
      const nameProp = findProperty(configObj.properties, "name");
      const inputProp = findProperty(configObj.properties, "input");
      const outputProp = findProperty(configObj.properties, "output");

      if (!nameProp || !isStringLiteral(nameProp.value)) {
        errors.push({
          sourceFile,
          message: "defineHttpAdapter requires a static string `name` property",
        });
        return;
      }

      if (!inputProp || !isFunctionExpression(inputProp.value)) {
        errors.push({
          sourceFile,
          message:
            "defineHttpAdapter requires `input` to be a function expression in the same file",
        });
        return;
      }

      const inputFn = inputProp.value as ArrowFunctionExpression | FunctionExpression;
      if (inputFn.async) {
        errors.push({
          sourceFile,
          message:
            "defineHttpAdapter `input` must be synchronous (the runtime does not support async/await)",
        });
        return;
      }

      const hasOutput = outputProp !== null;
      if (outputProp) {
        if (!isFunctionExpression(outputProp.value)) {
          errors.push({
            sourceFile,
            message:
              "defineHttpAdapter `output` must be a function expression in the same file when present",
          });
          return;
        }
        const outputFn = outputProp.value as ArrowFunctionExpression | FunctionExpression;
        if (outputFn.async) {
          errors.push({
            sourceFile,
            message:
              "defineHttpAdapter `output` must be synchronous (the runtime does not support async/await)",
          });
          return;
        }
      }

      adapters.push({
        name: nameProp.value.value,
        sourceFile,
        hasOutput,
      });
      // The call's arguments have already been validated above; don't descend
      // into them again, which would double-count any nested defineHttpAdapter
      // call (e.g. when arguments themselves contain expressions).
      return;
    }

    for (const key of Object.keys(node)) {
      const child = node[key] as unknown;
      if (Array.isArray(child)) {
        child.forEach((c: unknown) => walk(c as ASTNode | null));
      } else if (child && typeof child === "object") {
        walk(child as ASTNode);
      }
    }
  }

  walk(program as unknown as ASTNode);

  if (adapters.length > 1) {
    errors.push({
      sourceFile,
      message: `Expected exactly one defineHttpAdapter call per file, found ${adapters.length}`,
    });
    return { adapters: [], errors };
  }

  return { adapters, errors };
}
