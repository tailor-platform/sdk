import ml from "#/utils/multiline";

/**
 * Generate the JSONL seed-data loader embedded in `exec.mjs`.
 * @returns JavaScript source defining `loadSeedData`
 */
export function generateSeedDataLoaderCode(): string {
  return ml /* js */ `
    const loadSeedData = (
      dataDir,
      typeNames,
      { requireId = false, requiredFieldsByType = {} } = {},
    ) => {
      const data = {};
      for (const typeName of typeNames) {
        const jsonlPath = join(dataDir, \`\${typeName}.jsonl\`);
        try {
          const lines = readFileSync(jsonlPath, "utf-8").split("\\n");
          const records = [];
          for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            if (lines[lineIndex].trim() === "") continue;
            const record = JSON.parse(lines[lineIndex]);
            if (requireId && (record?.id === undefined || record?.id === null)) {
              throw new Error(
                \`\${jsonlPath}:\${lineIndex + 1}: \\\`id\\\` is required with --upsert\`,
              );
            }
            const missingRequiredField = (requiredFieldsByType[typeName] || []).find(
              (field) => record?.[field] === undefined || record?.[field] === null,
            );
            if (missingRequiredField) {
              throw new Error(
                \`\${jsonlPath}:\${lineIndex + 1}: field \\\`\${missingRequiredField}\\\` is required with --upsert\`,
              );
            }
            records.push(record);
          }
          data[typeName] = records;
        } catch (error) {
          if (error.code === "ENOENT") {
            data[typeName] = [];
          } else {
            throw error;
          }
        }
      }
      return data;
    };
  `;
}
