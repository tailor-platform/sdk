export interface ILoader<T> {
  load(filePath: string): Promise<T>;
}

export interface ITransformer<T> {
  transform(filePath: string, item: T, tempDir: string): string[];
}

export interface BundlerConfig<T> {
  namespace: string;
  serviceConfig: {
    files?: string[];
  };
  loader: ILoader<T>;
  transformer: ITransformer<T>;
  outputDirs: {
    preBundle: string;
    postBundle: string;
  };
  shouldProcess?: (item: T) => boolean;
}
