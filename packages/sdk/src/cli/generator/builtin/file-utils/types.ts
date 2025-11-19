/**
 * Type definitions for file utils generation.
 */

export interface FileUtilMetadata {
  name: string;
  fileFields: string[];
}

export interface FileUtilNamespaceMetadata {
  namespace: string;
  types: FileUtilMetadata[];
}
