/**
 * DB Type Generator用の型定義
 */
export interface DbTypeMetadata {
  name: string;
  typeDef: string;
}

/**
 * リレーション情報
 */
export interface RelationInfo {
  fieldName: string;
  targetType: string;
  relationType: "1-1" | "1-n" | "n-1";
  isOptional: boolean;
  backwardField?: string;
}

/**
 * 型変換コンテキスト
 */
export interface TypeProcessingContext {
  types: Record<string, any>;
  processedTypes: Set<string>;
  relations: Map<string, RelationInfo[]>;
}
