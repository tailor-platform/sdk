import { GraphQLType } from "../../types/types";

export interface SDLTypeMetadata {
  name: string;
  fields: SDLFieldMetadata[];
  isInput: boolean;
}

export interface SDLFieldMetadata {
  name: string;
  description?: string;
  type: GraphQLType;
  required: boolean;
  array: boolean;
}

/**
 * ResolverのSDLメタデータ型定義
 */
export interface ResolverSDLMetadata {
  name: string;
  sdl: string;
  inputType: string;
  outputType: string;
  queryType: "query" | "mutation";
  pipelines: unknown[];
}

/**
 * SDL生成に関連する共通型定義
 */
export interface SDLGenerationContext {
  types: SDLTypeMetadata[];
  resolvers: ResolverSDLMetadata[];
}

/**
 * SDL生成オプション
 */
export interface SDLGenerationOptions {
  includeComments?: boolean;
  sortTypes?: boolean;
  validateSchema?: boolean;
}
