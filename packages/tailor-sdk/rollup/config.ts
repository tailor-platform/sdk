import { RollupOptions } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import esbuild from 'rollup-plugin-esbuild';
import replace from '@rollup/plugin-replace';
import { decoratorRemover, resolverRemover, resolverEntry, resolverNameOutput } from './plugins';
import path from 'path';
/**
 * Rollup configuration for Tailor SDK
 * 
 * This configuration:
 * - Processes TypeScript files with decorators and resolver calls
 * - Removes decorators and resolver calls from the compiled output
 * - Optimizes imports and code structure
 */
export function createRollupConfig(options: {
  input?: string[];
  outputDir?: string;
  tsconfig?: string;
}): RollupOptions {
  const {
    input = [],
    outputDir = 'dist/functions',
    tsconfig = './tsconfig.json'
  } = options;

  return {
    input,
    
    output: {
      dir: outputDir,
      format: 'esm',
      sourcemap: true,
      preserveModules: false,
      hoistTransitiveImports: false,
      interop: 'auto',
    },
    external: [],
    
    plugins: [
      resolverNameOutput(),
      decoratorRemover(),
      resolverRemover(),
      resolverEntry(),
      esbuild({
        target: 'es2020',
        minify: true,
        tsconfig: './tsconfig.json',
        // デコレーター構文を残さない設定
        tsconfigRaw: {
          compilerOptions: {
            //module: 'ESNext',
            experimentalDecorators: true,
            //emitDecoratorMetadata: false,
            //removeComments: true,
            preserveValueImports: false,  // 未使用インポートの削除を許可
            importsNotUsedAsValues: 'remove', // 型インポートの削除
          }
        }
      }),
      
      // Resolve node modules
      nodeResolve({ 
        browser: true,
        modulesOnly: false,
      }),
      
      // Process CommonJS modules
      commonjs(),
    ],
  };
}