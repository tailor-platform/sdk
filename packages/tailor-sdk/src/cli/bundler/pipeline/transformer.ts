import * as fs from "node:fs";
import * as path from "node:path";
import ml from "multiline-ts";
import { type Resolver } from "@/parser/service/pipeline/types";
import { type ITransformer } from "@/cli/bundler";
import { DB_WRAPPER_DEFINITION, wrapDbFn } from "@/cli/bundler/wrapper";
import { pathToFileURL } from "node:url";

export class CodeTransformer implements ITransformer {
  constructor() {}

  async transform(filePath: string, tempDir: string): Promise<string[]> {
    const sourceText = fs.readFileSync(filePath).toString();
    const transformedPath = path.join(
      path.dirname(filePath),
      path.basename(filePath, ".js") + ".transformed.js",
    );

    const resolver = (
      await import(`${pathToFileURL(filePath)}?t=${new Date().getTime()}`)
    ).default as Resolver;

    // Export the body function
    const bodyVariableName = "$tailor_resolver_body";
    fs.writeFileSync(
      transformedPath,
      ml /* js */ `
      ${sourceText}

      export const ${bodyVariableName} = ${resolver.body?.toString()};
      `,
    );

    const functionDir = path.join(tempDir, "functions");
    fs.mkdirSync(functionDir, { recursive: true });

    // Create single body function file
    const bodyFilePath = path.join(functionDir, `${resolver.name}__body.js`);
    const relativePath = path
      .relative(functionDir, transformedPath)
      .replace(/\\/g, "/");

    const dbNamespace = resolver.options?.dbNamespace;

    let bodyContent;
    if (dbNamespace) {
      bodyContent = ml /* js */ `
        import { ${bodyVariableName} } from "${relativePath}";

        ${DB_WRAPPER_DEFINITION}
        globalThis.main = ${wrapDbFn(dbNamespace, bodyVariableName)};
      `;
    } else {
      bodyContent = ml /* js */ `
        import { ${bodyVariableName} } from "${relativePath}";
        globalThis.main = ${bodyVariableName};
      `;
    }

    fs.writeFileSync(bodyFilePath, bodyContent);
    return [bodyFilePath];
  }
}
