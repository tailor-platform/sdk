import type { FileUtilMetadata } from "./types";
import type { NormalizedTailorDBType } from "@/parser/service/tailordb/types";

/**
 * Process a TailorDB type and extract file field metadata.
 * @param type - The parsed TailorDB type to process
 * @returns File utility metadata for the type
 */
export async function processFileType(type: NormalizedTailorDBType): Promise<FileUtilMetadata> {
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
