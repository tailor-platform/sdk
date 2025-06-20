/**
 * オブジェクトがResolverインスタンスかどうかを判定する
 * ESモジュール環境でのinstanceofチェック問題を回避するため、プロパティベースチェックを使用
 *
 * @param obj 判定対象のオブジェクト
 * @returns Resolverオブジェクトの場合true、そうでなければfalse
 */
export function isResolver(value: unknown): boolean {
  if (value == null || typeof value !== "object") {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    typeof obj.queryType === "string" &&
    typeof obj.name === "string" &&
    typeof obj.input === "object" &&
    typeof obj.fnStep === "function" &&
    typeof obj.sqlStep === "function" &&
    typeof obj.gqlStep === "function" &&
    typeof obj.returns === "function"
  );
}
