import { isNodeBuiltinImport } from "@/cli/services/http-adapter/node-builtins";
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
import { HTTP_METHOD_KEYS, type HttpMethodKey } from "@/types/http-adapter";
import type {
  Program,
  CallExpression,
  ObjectExpression,
  ArrowFunctionExpression,
  Function as FunctionExpression,
  ImportDeclaration,
} from "@oxc-project/types";

export interface HttpAdapterLocation {
  name: string;
  sourceFile: string;
  methods: HttpMethodKey[];
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
 * Find the single createHttpAdapter call in a source file.
 *
 * By convention, an HTTP adapter file contains exactly one default export of
 * `createHttpAdapter({...})`. Multiple calls within one file produce an error.
 * The `name` property must be a string literal so it can be statically resolved.
 * `input` must be an object literal with at least one method key
 * (`get`/`post`/`put`/`patch`/`delete`) bound to a non-async function expression.
 * `output` is optional; when present it must also be a non-async function expression.
 * Any unknown key on `input` (e.g. a typo like `delte`) is rejected so that
 * misspelled methods fail loudly rather than being silently ignored.
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
  const bindings = collectSdkBindings(program, "createHttpAdapter");
  let sawCreateHttpAdapterCall = false;

  function walk(node: ASTNode | null | undefined): void {
    if (!node || typeof node !== "object") return;

    if (isSdkFunctionCall(node, bindings, "createHttpAdapter")) {
      sawCreateHttpAdapterCall = true;
      const callExpr = node as unknown as CallExpression;
      const args = callExpr.arguments;
      if (!args || args.length < 1 || args[0]?.type !== "ObjectExpression") {
        errors.push({
          sourceFile,
          message: "createHttpAdapter requires an object literal as its sole argument",
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
          message: "createHttpAdapter requires a static string `name` property",
        });
        return;
      }

      if (!inputProp || inputProp.value.type !== "ObjectExpression") {
        errors.push({
          sourceFile,
          message:
            "createHttpAdapter `input` must be an object literal keyed by HTTP method (get/post/put/patch/delete)",
        });
        return;
      }

      const inputObj = inputProp.value as ObjectExpression;
      const allowedKeys = new Set<string>(HTTP_METHOD_KEYS);
      let unknownKeyError = false;
      for (const prop of inputObj.properties) {
        if (prop.type === "SpreadElement") {
          errors.push({
            sourceFile,
            message:
              "createHttpAdapter `input` must be a plain object literal; spread elements are not allowed",
          });
          unknownKeyError = true;
          break;
        }
        if (prop.type !== "Property") continue;
        const keyNode = prop.key;
        const keyName =
          keyNode.type === "Identifier"
            ? keyNode.name
            : keyNode.type === "Literal"
              ? (keyNode as { value?: unknown }).value
              : undefined;
        if (typeof keyName !== "string" || !allowedKeys.has(keyName)) {
          errors.push({
            sourceFile,
            message: `createHttpAdapter \`input\` contains unknown key "${String(keyName)}"; allowed keys are ${HTTP_METHOD_KEYS.join("/")}`,
          });
          unknownKeyError = true;
          break;
        }
      }
      if (unknownKeyError) return;

      const methods: HttpMethodKey[] = [];
      let methodValidationError = false;
      for (const key of HTTP_METHOD_KEYS) {
        const handlerProp = findProperty(inputObj.properties, key);
        if (!handlerProp) continue;
        if (!isFunctionExpression(handlerProp.value)) {
          errors.push({
            sourceFile,
            message: `createHttpAdapter \`input.${key}\` must be a function expression in the same file`,
          });
          methodValidationError = true;
          break;
        }
        const fn = handlerProp.value as ArrowFunctionExpression | FunctionExpression;
        if (fn.async) {
          errors.push({
            sourceFile,
            message: `createHttpAdapter \`input.${key}\` must be synchronous (the runtime does not support async/await)`,
          });
          methodValidationError = true;
          break;
        }
        methods.push(key);
      }
      if (methodValidationError) return;

      if (methods.length === 0) {
        errors.push({
          sourceFile,
          message:
            "createHttpAdapter `input` must declare at least one HTTP method handler (get/post/put/patch/delete)",
        });
        return;
      }

      const hasOutput = outputProp !== null;
      if (outputProp) {
        if (!isFunctionExpression(outputProp.value)) {
          errors.push({
            sourceFile,
            message:
              "createHttpAdapter `output` must be a function expression in the same file when present",
          });
          return;
        }
        const outputFn = outputProp.value as ArrowFunctionExpression | FunctionExpression;
        if (outputFn.async) {
          errors.push({
            sourceFile,
            message:
              "createHttpAdapter `output` must be synchronous (the runtime does not support async/await)",
          });
          return;
        }
      }

      adapters.push({
        name: nameProp.value.value,
        sourceFile,
        methods,
        hasOutput,
      });
      // The call's arguments have already been validated above; don't descend
      // into them again, which would double-count any nested createHttpAdapter
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

  if (sawCreateHttpAdapterCall) {
    for (const stmt of program.body ?? []) {
      if (stmt.type !== "ImportDeclaration") continue;
      const importDecl = stmt as ImportDeclaration;
      const source = importDecl.source;
      if (!source || typeof source.value !== "string") continue;
      if (isNodeBuiltinImport(source.value)) {
        errors.push({
          sourceFile,
          message: `HTTP adapter imports Node module "${source.value}", which is unavailable in the gateway runtime`,
        });
      }
    }
  }

  if (adapters.length > 1) {
    errors.push({
      sourceFile,
      message: `Expected exactly one createHttpAdapter call per file, found ${adapters.length}`,
    });
    return { adapters: [], errors };
  }

  return { adapters, errors };
}
