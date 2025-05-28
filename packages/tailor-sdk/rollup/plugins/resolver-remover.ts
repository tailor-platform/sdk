import { Plugin } from 'rollup';
import * as ts from 'typescript';
import MagicString from 'magic-string';
import { readFileSync } from 'fs';

/**
 * Rollup plugin to remove resolver function calls and exports
 * 
 * Removes:
 * - resolver/queryResolver function calls but keeps their second argument
 * - Default exports of resolver variables
 * - Processes differently based on the function name in the second argument (functionStep, asyncFunctionStep, etc.)
 * - Adds appropriate stub code based on the step type
 */
export function resolverRemover(): Plugin {
  return {
    name: 'resolver-remover',
    transform(code: string, id: string) {
      // TypeScriptファイルだけを処理
      if (!id.endsWith('.ts') && !id.endsWith('.tsx')) {
        return null;
      }

      console.log(`Processing resolver calls in: ${id}`);
      
      // TypeScriptのソースファイルを解析
      const sourceFile = ts.createSourceFile(
        id,
        code,
        ts.ScriptTarget.Latest,
        true
      );

      // コード変更を追跡するためのMagicStringインスタンスを作成
      const magicString = new MagicString(code);
      
      // 変更が行われたかどうかを追跡するフラグ
      let modified = false;
      
      // resolver/queryResolver関数呼び出しとexport defaultを見つけて処理
      function visit(node: ts.Node) {
        // resolver/queryResolver関数呼び出しの変数宣言を検出
        if (ts.isVariableStatement(node)) {
          const declarations = node.declarationList.declarations;
          
          for (const declaration of declarations) {
            if (declaration.initializer && 
                ts.isCallExpression(declaration.initializer) &&
                ts.isIdentifier(declaration.initializer.expression)) {
              
              const functionName = declaration.initializer.expression.text;
              
              if (functionName === 'resolver' || functionName === 'queryResolver') {
                // resolver/queryResolver関数呼び出しの第二引数を抽出
                const callExpression = declaration.initializer as ts.CallExpression;
                if (callExpression.arguments.length >= 2) {
                  const secondArg = callExpression.arguments[1];
                  
                  // 第二引数の関数名を取得
                  let secondArgFunctionName: string | null = null;
                  if (ts.isCallExpression(secondArg) && ts.isIdentifier(secondArg.expression)) {
                    secondArgFunctionName = secondArg.expression.text;
                  }
                  
                  const secondArgText = code.substring(secondArg.pos, secondArg.end);
                  const varName = declaration.name.getText();
                  
                  // 関数名に基づいて処理を分岐
                  if (secondArgFunctionName) {
                    // 変数宣言を第二引数だけに置き換え、関数名によって処理を分岐
                    switch (secondArgFunctionName) {
                      case 'functionStep':
                        // functionStepの場合のスタブコード追加
                        magicString.overwrite(
                          node.pos, 
                          node.end, 
                          `// functionStep stub code
// This is the implementation for a function step
function functionStep(name, fn) {
  return fn;
}
const ${varName} = ${secondArgText};
// Add any necessary functionStep-specific logic here`
                        );
                        break;
                        
                      case 'sqlStep':
                        // sqlStepの場合のスタブコード追加
                        magicString.overwrite(
                          node.pos, 
                          node.end, 
                          `// This is the implementation for an SQL step
function sqlStep(name, namespace, query) {
  return async function(input) {
    const client = new tailordb.Client({
      namespace: namespace,
    });
    await client.connect();
    await client.queryObject("BEGIN");
    const result = await client.queryObject(query, input.input);
    await client.queryObject("ROLLBACK");
    await client.end();
    return {
      collection: result.rows
    }
  }
}
const ${varName} = ${secondArgText};`
                        );
                        break;
                        
                      default:
                        throw new Error(`Unknown function step type: ${secondArgFunctionName}`);
                    }
                  } else {
                    throw new Error(`Could not find function name in second argument of resolver call`);
                  }
                  
                  modified = true;
                  return;
                }
              }
            }
          }
        }
        
        // export default文を検出
        if (ts.isExportAssignment(node) && node.isExportEquals === false) {
          // export default文を削除
          magicString.remove(node.pos, node.end);
          modified = true;
          return;
        }
        
        // 再帰的に子ノードを探索
        ts.forEachChild(node, visit);
      }
      
      // ASTを走査
      visit(sourceFile);
      
      // 変更があれば結果を返す
      if (modified) {
        console.log(`Successfully processed resolver calls in ${id}`);
        return {
          code: magicString.toString(),
          map: magicString.generateMap({ hires: true })
        };
      }
      
      return null;
    }
  };
}
