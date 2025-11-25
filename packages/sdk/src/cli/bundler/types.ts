export interface Loader<T> {
  load(filePath: string): Promise<T | null>;
}
