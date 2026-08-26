import type { TailorDBType } from "#/parser/service/tailordb/types";
import type { FileUtilMetadata } from "./types";

/**
 * Process a TailorDB table and extract file field metadata.
 * @param type - The parsed TailorDB table to process
 * @returns File utility metadata for the table
 */
export async function processFileType(type: TailorDBType): Promise<FileUtilMetadata> {
  const fileFields: string[] = [];

  if (type.files) {
    for (const fileFieldName of Object.keys(type.files)) {
      fileFields.push(fileFieldName);
    }
  }

  return {
    name: type.name,
    fileFields,
  };
}
