import type { TailorDBType } from "#src/parser/service/tailordb/types";
import type { FileUtilMetadata } from "./types";

/**
 * Process a TailorDB type and extract file field metadata.
 * @param type - The parsed TailorDB type to process
 * @returns File utility metadata for the type
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
