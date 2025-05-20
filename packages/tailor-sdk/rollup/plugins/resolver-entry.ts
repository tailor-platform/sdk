import { Plugin } from 'rollup';

/**
 * Rollup plugin to detect files containing resolver/queryResolver calls
 * and handle them as entry points
 */
export function resolverEntry(): Plugin {
  const emitted = new Set<string>(); 

  return {
    name: 'resolver-entry',
    transform(code: string, id: string) {
      // Ignore files not under the ./resolvers folder
      if (!id.includes('/resolvers/')) return null;
      console.log("transform", id);
      
      // .ts/.tsxファイルのみを処理
      if (!/\.([t]sx?)$/.test(id)) return null;
      
      // 正規表現でresolverの呼び出しを検出
      const hasResolver = /\b(resolver|queryResolver)\s*\(/g.test(code);
      
      if (hasResolver && !emitted.has(id)) {
        console.log(`Found resolver in ${id}`);
        emitted.add(id);
        this.emitFile({ type: 'chunk', id });
      }

      return null;
    },
  };
}