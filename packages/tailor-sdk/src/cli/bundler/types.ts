import type { FileLoadConfig } from "@/cli/application/file-loader";

export interface Loader<T> {
  load(filePath: string): Promise<T | null>;
}

export interface Transformer {
  transform(filePath: string, tempDir: string): Promise<string[]>;
}

export interface BundlerConfig<T> {
  namespace: string;
  serviceConfig: FileLoadConfig;
  loader: Loader<T>;
  transformer: Transformer;
  outputDirs: {
    preBundle: string;
    postBundle: string;
  };
  shouldProcess?: (item: T) => boolean;
}
