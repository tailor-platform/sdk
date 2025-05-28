import { Plugin } from 'rollup';
import * as ts from 'typescript';
import MagicString from 'magic-string';

/**
 * Rollup plugin to remove TypeScript decorators from source files
 * 
 * Removes:
 * - Class decorators (@InputType(), @Type(), etc.)
 * - Property decorators (@TypeField(), @InputTypeField(), etc.)
 * - Inline decorators on the same line as property declarations
 * 
 * Uses TypeScript Compiler API for accurate decorator removal
 */
export function decoratorRemover(): Plugin {
  return {
    name: 'decorator-remover',
    transform(code: string, id: string) {
      // Only process TypeScript files
      if (!id.endsWith('.ts') && !id.endsWith('.tsx')) {
        return null;
      }

      console.log(`Processing TypeScript decorators in: ${id}`);

      // First parse the file to identify decorator nodes
      const sourceFile = ts.createSourceFile(
        id,
        code,
        ts.ScriptTarget.Latest,
        true
      );

      // Create a MagicString instance for precise text manipulation
      const magicString = new MagicString(code);
      
      // Keep track of decorator positions to remove
      const decoratorsToRemove: { start: number; end: number }[] = [];
      
      // Helper to identify decorator nodes
      function isDecorator(node: ts.Node): boolean {
        return node.kind === ts.SyntaxKind.Decorator;
      }
      
      // Process each node in the AST to find decorators
      function visit(node: ts.Node) {
        // Check if this node is a decorator
        if (isDecorator(node)) {
          decoratorsToRemove.push({
            start: node.getFullStart(),
            end: node.getEnd()
          });
        }
        
        // Continue traversing the AST
        ts.forEachChild(node, visit);
      }
      
      // Start the traversal from the root node
      visit(sourceFile);
      
      // Remove decorators in reverse order to avoid position shifts
      if (decoratorsToRemove.length > 0) {
        // Sort in reverse order to avoid position shifts
        decoratorsToRemove.sort((a, b) => b.start - a.start);
        
        for (const { start, end } of decoratorsToRemove) {
          magicString.remove(start, end);
        }
        
        console.log(`Successfully removed ${decoratorsToRemove.length} decorators from ${id}`);
        return {
          code: magicString.toString(),
          map: magicString.generateMap({ hires: true })
        };
      }
      
      return null;
    }
  };
}