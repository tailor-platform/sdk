export interface Loader<T> {
  load(filePath: string): Promise<T | null>;
}

export interface Transformer {
  transform(filePath: string, tempDir: string): Promise<string[]>;
}

export interface BundlerConfig<T> {
  namespace: string;
  serviceConfig: {
    files?: string[];
  };
  loader: Loader<T>;
  transformer: Transformer;
  outputDirs: {
    preBundle: string;
    postBundle: string;
  };
  shouldProcess?: (item: T) => boolean;
}
