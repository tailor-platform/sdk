import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import ml from "multiline-ts";
import { type ITransformer } from "@/cli/bundler";
import { type Resolver } from "@/parser/service/resolver";

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

    // Generate validation code using TailorField.parseObject
    const hasInput = resolver.input && Object.keys(resolver.input).length > 0;
    const bodyVariableName = "$tailor_resolver_body";
    const bodyFnStr = resolver.body?.toString() || "() => {}";

    // Modify sourceText to expose resolver for internal use
    let modifiedSourceText = sourceText;

    // Pattern 1: export default createResolver(...)
    const defaultExportRegex = /export\s+default\s+createResolver\s*\(/;
    if (defaultExportRegex.test(sourceText)) {
      modifiedSourceText = sourceText.replace(
        defaultExportRegex,
        "const _internalResolver = createResolver(",
      );
      modifiedSourceText += "\nexport default _internalResolver;";
    }
    // Pattern 2: export { name_default as default } (bundled code)
    else {
      const bundledExportMatch = sourceText.match(
        /export\s*\{\s*(\w+)\s+as\s+default\s*\}/,
      );
      if (bundledExportMatch) {
        const exportedName = bundledExportMatch[1];
        // Add alias after the export statement
        modifiedSourceText += `\nconst _internalResolver = ${exportedName};`;
      }
    }

    // If there's input validation, wrap the body with parse call
    const wrappedBodyCode = hasInput
      ? ml /* js */ `
async (context) => {
  if (_internalResolver.input) {
    const result = t.object(_internalResolver.input).parse({
      value: context.input,
      data: context.input,
      user: context.user,
    });

    if (result.issues) {
      const errorMessages = result.issues
        .map(issue => {
          const path = issue.path ? issue.path.join('.') : '';
          return path ? \`  \${path}: \${issue.message}\` : issue.message;
        })
        .join('\\n');
      throw new Error(\`Failed to input validation:\\n\${errorMessages}\`);
    }
  }

  const originalBody = ${bodyFnStr};
  return originalBody(context);
}
`
      : bodyFnStr;

    fs.writeFileSync(
      transformedPath,
      ml /* js */ `
      ${modifiedSourceText}

      export const ${bodyVariableName} = ${wrappedBodyCode};
      `,
    );

    const functionDir = path.join(tempDir, "functions");
    fs.mkdirSync(functionDir, { recursive: true });

    // Create single body function file
    const bodyFilePath = path.join(functionDir, `${resolver.name}__body.js`);
    const relativePath = path
      .relative(functionDir, transformedPath)
      .replace(/\\/g, "/");

    const bodyContent = ml /* js */ `
      import { ${bodyVariableName} } from "${relativePath}";
      globalThis.main = ${bodyVariableName};
    `;
    fs.writeFileSync(bodyFilePath, bodyContent);
    return [bodyFilePath];
  }
}
