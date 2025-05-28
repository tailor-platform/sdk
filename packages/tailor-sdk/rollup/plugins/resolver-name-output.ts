import { Plugin, OutputBundle } from 'rollup';
import { json } from 'stream/consumers';

/**
 * Rollup plugin to extract resolver names from function calls and use them as output filenames
 * 
 * This plugin:
 * - Detects resolver/queryResolver function calls in TypeScript files
 * - Extracts the resolver name (first string argument to resolver() call)
 * - Uses the extracted name as the output filename for the compiled JavaScript
 */
export function resolverNameOutput(): Plugin {
  // Store resolver names by file id
  const resolverNamesByFile = new Map<string, string[]>();

  return {
    name: 'resolver-name-output',
    
    // First pass: extract resolver names from code
    transform(code: string, id: string) {
      if (id.includes('node_modules') && !id.endsWith('.ts')) return null;
      
      try {
        // Find resolver function calls using regex for initial detection
        const resolverRegex = /\b(resolver|queryResolver)\s*\(\s*["']([^"']+)["']/g;
        let match: RegExpExecArray | null;
        const resolverNames: string[] = [];
        
        while ((match = resolverRegex.exec(code)) !== null) {
          resolverNames.push(match[2]); // Capture the resolver name (first string arg)
        }
        
        if (resolverNames.length > 0) {
          resolverNamesByFile.set(id, resolverNames);
        }
      } catch (error) {
        console.error(`Error processing resolver names in ${id}:`, error);
      }
      
      return null; // Don't modify the code
    },
    
    // Second pass: rename output chunks based on resolver names
    generateBundle(outputOptions, bundle: OutputBundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') return;
        const originalId = chunk.facadeModuleId;
        if (originalId && resolverNamesByFile.has(originalId)) {
          const resolverNames = resolverNamesByFile.get(originalId)!;
          if (resolverNames.length > 0) {
            // Use the first resolver name found in the file
            const resolverName = resolverNames[0];
            const newFileName = `${resolverName}.js`;
            
            // Rename the chunk
            console.log(`Renaming output: ${fileName} -> ${newFileName}`);
            chunk.fileName = newFileName;
            chunk.exports = []
            bundle[newFileName] = chunk;
            delete bundle[fileName];

            // Also rename the source map file if it exists
            const originalMapFileName = `${fileName}.map`;
            if (bundle[originalMapFileName]) {
              const newMapFileName = `${resolverName}.js.map`;
              console.log(`Renaming output: ${originalMapFileName} -> ${newMapFileName}`);
              
              const map = bundle[originalMapFileName];
              if (map.type === 'asset' && typeof map.source === 'string') {
                map.fileName = newMapFileName;
                const parsedSource = JSON.parse(map.source);
                parsedSource.file = newFileName;
                map.source = JSON.stringify(parsedSource);
                bundle[newMapFileName] = map;
                delete bundle[originalMapFileName];
              }
            }
          }
        }
      }
    }
  };
}