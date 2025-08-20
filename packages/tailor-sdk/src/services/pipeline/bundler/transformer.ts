/* eslint-disable no-case-declarations */

import fs from "node:fs";
import path from "node:path";
import ml from "multiline-ts";
import { Resolver } from "../resolver";
import { ITransformer } from "@/bundler";
import { trimSDKCode } from "@/bundler/utils";
import { DB_WRAPPER_DEFINITION, wrapDbFn } from "@/bundler/wrapper";

export class CodeTransformer implements ITransformer<Resolver> {
  constructor() {}

  transform(filePath: string, resolver: Resolver, tempDir: string): string[] {
    const trimmedContent = trimSDKCode(filePath);
    const transformedPath = path.join(
      path.dirname(filePath),
      path.basename(filePath, ".js") + ".transformed.js",
    );
    fs.writeFileSync(
      transformedPath,
      ml /* js */ `
      ${trimmedContent}

      ${resolver.steps
        .flatMap(([type, name, fn]) => {
          switch (type) {
            case "fn":
            case "sql":
              return [
                /* js */ `export const ${stepVariableName(
                  name,
                )} = ${fn.toString()};`,
              ];
            case "gql":
              return [];
            default:
              throw new Error(`Unsupported step type: ${type}`);
          }
        })
        .join("\n")}

      `,
    );

    const stepDir = path.join(tempDir, "steps");
    fs.mkdirSync(stepDir, { recursive: true });

    return resolver.steps
      .filter(([type]) => type !== "gql")
      .flatMap(([type, name, _, options]) => {
        const stepFilePath = path.join(stepDir, `${resolver.name}__${name}.js`);
        const stepFunctionVariable = stepVariableName(name);
        const relativePath = path.relative(stepDir, transformedPath);
        let stepContent;
        switch (type) {
          case "fn":
            stepContent = ml /* js */ `
                import { ${stepFunctionVariable} } from "${relativePath}";
                globalThis.main = ${stepFunctionVariable};
              `;
            break;
          case "sql":
            const dbNamespace =
              options?.dbNamespace || resolver.options?.defaults?.dbNamespace;
            if (!dbNamespace) {
              throw new Error(
                `Database namespace is not defined at ${resolver.name} > ${name}`,
              );
            }
            stepContent = ml /* js */ `
                import { ${stepFunctionVariable} } from "${relativePath}";

                ${DB_WRAPPER_DEFINITION}
                globalThis.main = ${wrapDbFn(
                  dbNamespace,
                  stepFunctionVariable,
                )};
              `;
            break;
          default:
            return [];
        }

        fs.writeFileSync(stepFilePath, stepContent);
        return [stepFilePath];
      });
  }
}

function stepVariableName(stepName: string) {
  return `$tailor_resolver_step__${stepName}`;
}
