import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import ml from "multiline-ts";
import { type ITransformer } from "@/cli/bundler";
import { type TailorType, type TailorField } from "@/configure/types/type";
import { type Resolver } from "@/parser/service/pipeline";

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

    // Generate validation code for input fields
    const generateValidationCode = (
      type: TailorType<any, any> | undefined,
      dataPath: string,
      displayPath: string,
    ): string => {
      if (!type || !type.fields) {
        return "";
      }

      const validationCode: string[] = [];
      validationCode.push(/* js */ `const validationErrors = [];`);
      validationCode.push(
        /* js */ `const commonArgs = { data: ${dataPath}, user: context.user };`,
      );

      // Recursive function to process fields including nested objects
      const processFields = (
        fields: Record<string, TailorField<any, any>>,
        currentDataPath: string,
        currentDisplayPath: string,
      ) => {
        for (const [fieldName, field] of Object.entries(fields)) {
          const metadata = (field as TailorField<any, any>).metadata;
          const fieldDataPath = `${currentDataPath}.${fieldName}`;
          const fieldDisplayPath = `${currentDisplayPath}.${fieldName}`;

          // Check if this is a nested object (t.object())
          const nestedFields = (field as TailorField<any, any>).fields;
          if (
            nestedFields &&
            typeof nestedFields === "object" &&
            Object.keys(nestedFields).length > 0
          ) {
            // Process nested fields recursively
            processFields(nestedFields, fieldDataPath, fieldDisplayPath);
          }

          // Process validation functions for this field
          const validateFns = metadata.validate;
          if (!validateFns || validateFns.length === 0) {
            continue;
          }

          for (let i = 0; i < validateFns.length; i++) {
            const validateInput = validateFns[i];
            const { fn, message } =
              typeof validateInput === "function"
                ? {
                    fn: validateInput.toString(),
                    message: `Validation failed`,
                  }
                : {
                    fn: validateInput[0].toString(),
                    message: validateInput[1],
                  };

            validationCode.push(ml /* js */ `
              if (!(${fn})({ value: ${fieldDataPath}, ...commonArgs })) {
                validationErrors.push(\`${fieldDisplayPath}: ${message}\`);
              }
            `);
          }
        }
      };

      processFields(type.fields, dataPath, displayPath);

      validationCode.push(ml /* js */ `
        if (validationErrors.length > 0) {
          throw new Error(validationErrors.join("\\n"));
        }
      `);

      return validationCode.join("\n");
    };

    const inputValidationCode = generateValidationCode(
      resolver.input as TailorType<any, any> | undefined,
      "context.input",
      "input",
    );

    // Export the body function wrapped with validation
    const bodyVariableName = "$tailor_resolver_body";
    const bodyFnStr = resolver.body?.toString() || "() => {}";
    const wrappedBodyCode = inputValidationCode
      ? ml /* js */ `
        async (context) => {
        ${inputValidationCode
          .split("\n")
          .map((line) => /* js */ `  ${line}`)
          .join("\n")}
          const originalBody = ${bodyFnStr};
          return originalBody(context);
        }`
      : bodyFnStr;

    fs.writeFileSync(
      transformedPath,
      ml /* js */ `
      ${sourceText}

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
