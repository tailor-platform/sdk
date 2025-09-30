import * as fs from "node:fs";
import * as path from "node:path";
import ml from "multiline-ts";
import { type Resolver } from "../resolver";
import { type ITransformer } from "@/bundler";
import { trimSDKCode } from "@/bundler/utils";
import { DB_WRAPPER_DEFINITION, wrapDbFn } from "@/bundler/wrapper";
import { pathToFileURL } from "node:url";

export class CodeTransformer implements ITransformer {
  constructor() {}

  async transform(filePath: string, tempDir: string): Promise<string[]> {
    const trimmedContent = trimSDKCode(filePath);
    const transformedPath = path.join(
      path.dirname(filePath),
      path.basename(filePath, ".js") + ".transformed.js",
    );

    const resolver = (
      await import(`${pathToFileURL(filePath)}?t=${new Date().getTime()}`)
    ).default as Resolver;
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
        const relativePath = path
          .relative(stepDir, transformedPath)
          .replace(/\\/g, "/");
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
