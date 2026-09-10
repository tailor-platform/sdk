# typed-sql × Tailor SDK PoC

SDKの`db.table()`定義をtyped-sqlのスキーマに変換し、生SQLの結果型・引数型を推論するローカル実験です。SDK本体の公開API・依存関係は変更しません。

## 再実行

Node.js 24.13.0、pnpm 11.25.0、typed-sql 2.1.0、TypeScript 7.0.2で確認しました。

リポジトリルートで依存をインストールしてから実行します。

```sh
pnpm install --frozen-lockfile
cd experiments/typed-sql
pnpm install --frozen-lockfile
pnpm test
```

このディレクトリは独立したpnpm workspaceです。TypeScript 7.0.2はPoCにのみインストールされ、SDKのTypeScript 6.0.3には影響しません。

## 実装

1. `schema.mjs`でSDKの`db.table()`を使い、AccountとProjectを定義します。
2. SDKの実際のschema validationと`parseTypes()`に通します。
3. PoCプラグインの`onTailorDBReady`をローカルで呼び、namespaceごとのカタログを生成します。SDK CLIへの登録・CLI経由のgenerateは今回の範囲外です。
4. typed-sqlの公開API `checkFile()`がSQLを解析し、推論型を挿入した一時ソースをTypeScript 7.0.2で検査します。
5. 期待した成功・SQL診断・TypeScriptエラーをassertで検証します。一致しない場合は終了コード1になります。

列のTypeScript型にはSDKの`mapFieldTypeToColumnType()`と型エイリアス定義を再利用しています。SQL側の型名への対応表とenumカタログはPoCで生成します。enumの合成型名は解析用であり、Platform内部の物理型名を再現したものではありません。

## 確認結果

14/14のチェックが期待どおりの結果になりました。負例がエラーになることと、既知の制限を再現するケースもこの件数に含みます。

| ケース                          | 実測結果                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| scalar・nullable・enum          | UUID/string、integer/number、decimal/string、Date、enum unionを推論。期待する行型との完全一致をTSで検査 |
| LEFT JOIN                       | Projectの必須列も`string \| null`になる                                                                 |
| INNER JOIN                      | Projectの必須列は`string`で、直接メソッドを呼べる                                                       |
| 複数パラメータ                  | `readonly [number, "ADMIN" \| "MEMBER", boolean]`を推論し、完全一致を検査                               |
| 存在しない列                    | `TSQ101: Unknown column emali`                                                                          |
| 存在しないテーブル              | `TSQ100: Unknown table MissingAccount`                                                                  |
| 数値パラメータに文字列          | `TS2345`                                                                                                |
| 同じ負例を変換前の通常tscで検査 | エラーなし。typed-sqlによるSQL解析・型挿入の効果を確認                                                  |
| enumパラメータに`"OWNER"`       | `TS2345`                                                                                                |
| LEFT JOIN結果のnullチェック漏れ | `TS18047: 'row.title' is possibly 'null'`                                                               |
| SDK側からemail列を除いて再解析  | `TSQ101: Unknown column email`                                                                          |
| nestedフィールド                | PoCのカタログ変換で明示的に拒否                                                                         |
| enumの名前衝突                  | `Order_Item.status`と`Order.Item_Status`の異なるenum値をそれぞれ正しく推論                              |
| CTE                             | PostgreSQL解析では成功。TailorDB互換性を保証できないことを示す対照例                                    |

たとえば、結果型を手書きしていないLEFT JOINから次の型が生成されます。

```ts
{
  email: string;
  title: string | null;
  budget: string | null;
}
```

`results/report.json`に診断・推論型・所要時間を保存します。`results/*.transformed.ts.txt`で実際に挿入された型を確認できます。スキーマは`results/poc.schema.json`です。

一時的なTypeScriptファイルは`node_modules/.cache`配下で検査し、終了時に削除します。意図的にエラーを含むfixtureは`.ts.txt`なので、SDK本体の型チェックに混入しません。`results/`は生成物としてGit対象外です。

## 判断と制限

**SDKの定義から、生SQLの静的検査と型推論につなぐ経路は成立しました。** 最も明確な差は、通常tscが見逃すSQLパラメータの型違いを検出できたことです。

ただし、この実装はSDK由来のカタログと型ポリシーをPostgreSQL dialectに渡したものです。TailorDB専用dialectではありません。

- このPoCのPostgreSQL解析は`WITH`を受け付けますが、TailorDBでの実行は検証していません。SQLが型検査を通ったことを、TailorDBで実行可能な証明として使えません。
- DBには接続していません。TailorDBの実行adapter、実際の戻り値、権限、関数、集約、DML、トランザクションは未検証です。
- 配列とnestedフィールドは変換時に拒否します。暗黙に`any`へ落としません。
- 利用しているスナップショットはtyped-sql 2.1.0が受理するformat v1です。v2への移行や完全なスキーマ依存関係の表現は未実装です。
- 専用チェック経路にはTypeScript 7.0.2が必要です。通常のエディタに対する推論・補完は追加していません。
- 記録する解析時間は同じ小さなクエリを100回解析したローカル測定で、全プロジェクトのチェック時間やSQL実行時間ではありません。

次の実装段階では、TailorDBが受理するSQLと結果型に合わせたdialectを用意し、実際の関数ランタイムとの一致を確認する必要があります。
