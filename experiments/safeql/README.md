# SafeQL × Tailor SDK PoC

SDKの`db.table()`定義からDDLを生成し、組み込みPostgreSQL（PGlite）に流し込んで、SafeQLで生SQLの静的検査と結果型の推論を行うローカル実験です。SDK本体の公開API・依存関係は変更しません。

typed-sql・Prisma TypedSQLとの比較を経て、SQLサポートの方式はSafeQLに絞りました。比較の経緯は「判断の経緯」にあります。

## 再実行

Node.js 24.13.0、pnpm 11.25.0、`@ts-safeql/eslint-plugin` 5.4.1、ESLint 10.12.0、TypeScript 6.0.3（SDKと同じ版）で確認しました。

```sh
pnpm install --frozen-lockfile
cd experiments/safeql
pnpm install --frozen-lockfile
pnpm test
```

このディレクトリは独立したpnpm workspaceで、リポジトリ標準のCIからは実行されません。

`pnpm-workspace.yaml`は`trustPolicy: no-downgrade`を有効にしています。SafeQLの依存`chokidar@4.0.3`と`synckit@0.10.4`は過去版にあった公開元証明（provenance）がなく、そのままではインストールが止まります。この2つだけ`trustPolicyExclude`に加えています。

## SafeQLにPostgreSQLサーバーは要らない

SafeQLは「SQLをDBに問い合わせて型を得る」方式ですが、サーバーのインストールや接続先DBは不要です。SafeQL 5.4.1の`plugins`設定には`createConnection`フックがあり、接続を自前で差し替えられます。このPoCでは次のようにしています。

1. `schema.mjs`がSDKの`db.table()`でAccountとProjectを定義し、SDKのパーサーに通します。`ddl.mjs`がそのパース結果から`CREATE TYPE`/`CREATE TABLE`を生成します。配列・nestedフィールドは、暗黙に型を落とさず拒否します。
2. `pglite-plugin.mjs`が`createConnection`で、プロセス内の組み込みPostgreSQL（PGlite）にDDLを流し込み、`pglite-socket`経由のpostgres.js接続をSafeQLに返します。ポートは自動採番です。
3. SDKはすでに`@electric-sql/pglite`をoptional peer依存にしており、`mockTailordbWithPGlite`でも使っています（`packages/sdk/package.json`、`docs/testing.md`）。

SafeQL標準の`migrationsDir`設定（DDLファイルから検証用DBを作る）は、DBの作成と削除のために実PostgreSQLサーバーへの接続が必要なので、サーバーなしでは使えません。このPoCでは試していません。

## 確認結果

18/18のチェックが期待どおりでした。SafeQLはソースを変換せず、`sql<{...}>`の型注釈をautofixで挿入する方式です。fixtureの`sql`は`./sql`のスタブ（`fixtures/_sql.ts.txt`）で、`RowOf<typeof query>`でautofix後の行型を取り出します。

型の対応は、bigint→number、numeric→string、date→Dateとしています。SafeQLの既定のままだとbigintが`string`になるため、`overrides.types: { int8: "number" }`を1行指定しています。numeric・dateは既定で一致しました。

「検出点」は、問題が最初にどこで見つかるかです。

| ケース                                     | 検出点       | 実測結果                                                                                                                                                                         |
| ------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| scalar・nullable・enum                     | なし（正常） | autofixで`{ id: string; ...; age: number; balance: string; birthday: Date \| null; createdAt: Date; role: 'ADMIN' \| 'MEMBER' }`を挿入。期待する行型との完全一致をTS 6.0.3で検査 |
| LEFT JOIN                                  | なし（正常） | `{ email: string; title: string \| null; budget: string \| null }`を推論                                                                                                         |
| INNER JOIN                                 | なし（正常） | `{ email: string; title: string }`を推論                                                                                                                                         |
| 複数パラメータ                             | なし（正常） | lintエラーなし                                                                                                                                                                   |
| 存在しない列                               | SQL解析      | `Invalid Query: column "emali" does not exist`                                                                                                                                   |
| 存在しないテーブル                         | SQL解析      | `Invalid Query: relation "MissingAccount" does not exist`                                                                                                                        |
| 数値パラメータに文字列リテラル`"eighteen"` | SQL解析      | `Invalid Query: invalid input syntax for type bigint: "eighteen"`                                                                                                                |
| 同じ負例をlintなしで通常のtscだけで検査    | なし         | エラーなし。ただしスタブの`sql`が引数を`unknown[]`で受けるため、SafeQLの設計についての証拠にはならない                                                                           |
| enumパラメータに`"OWNER"`                  | SQL解析      | `Invalid Query: invalid input value for enum "Account.role": "OWNER"`                                                                                                            |
| `string`型の変数を数値列と比較             | SQL解析      | `Invalid Query: operator does not exist: bigint > text`                                                                                                                          |
| `string`型の変数をenum列と比較             | SQL解析      | `Invalid Query: operator does not exist: "Account.role" = text`                                                                                                                  |
| `"ADMIN" \| "MEMBER"`型・`number`型の変数  | なし（正常） | lintエラーなし                                                                                                                                                                   |
| LEFT JOIN結果のnullチェック漏れ            | tsc          | autofix後に`TS18047: 'row.title' is possibly 'null'`                                                                                                                             |
| SDK側からemail列を除いて再生成             | SQL解析      | `Invalid Query: column "email" does not exist`                                                                                                                                   |
| nestedフィールド                           | DDL生成      | `PoC does not support Account.profile: arrays/nested fields`                                                                                                                     |
| enumの名前衝突                             | なし（正常） | `Order_Item.status`は`'A'`、`Order.Item_Status`は`'B'`を推論                                                                                                                     |
| CTE                                        | なし（正常） | PostgreSQLでは成功。TailorDB互換性を保証できないことを示す対照例                                                                                                                 |

`results/report.json`に診断・挿入された型・所要時間、`results/*.fixed.ts.txt`にautofix後のソース、`results/poc.schema.sql`に生成したDDLを保存します。`results/`は生成物としてGit対象外です。

enum型名の衝突は、DDLで型名を`"<テーブル名>.<フィールド名>"`と自分で決めているため、このPoCでは起きません。

## 計測

| 項目                                | SafeQL                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| 初回（DB起動・DDL適用・最初のlint） | 1.5〜2.4秒（3回の実行）                                                        |
| 2回目以降の1ファイル                | 2.8〜4.1ms（クエリ形を毎回変えた20回の平均を3回実行。lintのみでtscを含まない） |

小さなクエリのローカル測定で、全プロジェクトのチェック時間ではありません。

## 判断

結論: SQLサポートの方式は**SafeQL（組み込みPGlite接続）に絞る**。typed-sqlとPrisma TypedSQLは候補から外す。

別のPoCでの比較では、SafeQLとtyped-sqlの検出能力は同等でした。列・テーブルの存在、パラメータ型、enum、LEFT JOINのnullable化まで、同じfixtureで同じ結論になっています。SafeQLに絞る根拠は次のとおりです。

1. **メンテナンスの継続性。** SafeQLは2022年9月公開・105バージョン、最新コミットは2026-10-01です。typed-sqlはメンテナ1人で、2026年8月公開・npmの最終公開が2026-09-03から止まっています。
2. **検証をDBに任せられます。** SQLの意味はPostgreSQL本体が検証するため、SDKが解析器を持たずに済みます。DDLの生成だけでよく、SDKはすでにPGliteを使っています。
3. **ESLint上で動き、型は`sql<{...}>`としてソースに残ります。** 診断はESLintの診断としてエディタとCIに出ます。

TypeScript 7への対応状況（2026-10-06時点、typescript-eslintのissueで確認）:

- TS 7.0.2は`latest`ですが、JSのコンパイラAPIを同梱していません。`@typescript-eslint/parser`の最新8.71.1は、peer依存が`typescript >=4.8.4 <6.1.0`です。
- typescript-eslintのメンテナーは、TS 7.1が新しい別のAPIを出す予定で、それまでは対応できないと説明しています（#12518、#10940）。
- 対応は進行中です。追跡issue #10940は未クローズ（`team assigned`・`accepting PRs`）で、2026-09-29にメンテナーが「TS 7.1対応の作業は安定してきており、PR #12803を内部レビューに出せる状態にした」と書いています。リリース時期は示されていません（同メンテナーは9/11に「どれくらいかかるか分からない」と書いています）。
- TS 7.1の予定は、Beta 2026-10-06、RC 2026-11-10、Stable 2026-11-24です（TypeScript 7.1 Iteration Plan）。
- それまでの公式の回避策は、TS 6とTS 7を並走させる方法です。`typescript-eslint`にはTS 6のAPIを使わせ、`tsc`にはTS 7を使います。
- SafeQL本体も、`typescript`のAPIを直接使っています（`@ts-safeql/plugin-utils`の型定義が`typescript`の`TypeChecker`などを使う）。typescript-eslintが対応しても、SafeQL側の移行が別途必要になる可能性があります。SafeQLのリポジトリにはTS 7に関するissueは見つかりませんでした。

リスクと未検証:

- **TS 7への移行が上流頼みです。** typescript-eslintとSafeQLのリリースを待つことになります。時期は不明です。
- **依存が重いです。** このPoCのインストールは120パッケージ・109MBで、pnpmのtrust policyを有効にした環境では`chokidar`と`synckit`で止まります。
- **ESLintが前提です。** このリポジトリのlintはoxlintのみで、oxlintでSafeQLが動くかは未検証です。
- **TailorDBが受け付けるSQLの範囲。** `docs/testing.md`には「TailorDBはPostgreSQLのサブセットに対応する」とあります。SafeQLはPostgreSQL本体に問い合わせるため、通すSQLをTailorDBに合わせて絞れません。SafeQLのプラグイン型定義には`resolveQuery`・`typeCheck`などのフックがありますが、動作は試していません。
- PGliteプラグイン経由のエディタ連携、`as any`で型を潰した引数、スキーマ変更後に注釈が古くなる様子、実際の関数ランタイムの戻り値、権限・関数・集約・DML・トランザクションは未検証です。

## 判断の経緯

ここから先は、このPRに含まれない別のPoC（typed-sql）で測定・確認した記録です。同じSDK定義・同じfixtureで比べました。再現するファイルはこのPRにはありません。

### typed-sqlとの差分

- 診断の出どころが違います。typed-sqlは自前のSQL解析器の`TSQ100`/`TSQ101`、SafeQLはPostgreSQL本体のエラー文です。
- 型付き引数の検査は、どちらも変数の型だけで検出できました（typed-sqlはTS2345、SafeQLはlintエラー）。ただしSafeQLでは、`as any`などで型を潰した引数は検査できません。これは未検証です。
- typed-sqlは型を変換でソースに挿入するので、利用者のソースは`` sql`...` ``のままです。SafeQLはautofixで型注釈を書き込みます。

| 項目                                | SafeQL                                                                         | typed-sql                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 初回（DB起動・DDL適用・最初のlint） | 1.5〜2.4秒（3回の実行）                                                        | 該当なし（スナップショットのJSONを読むだけ）                                        |
| 2回目以降の1ファイル                | 2.8〜4.1ms（クエリ形を毎回変えた20回の平均を3回実行。lintのみでtscを含まない） | SQL解析は0.13〜0.24ms（100回の平均を2回実行）。tscまで含む`checkFile`は約200〜560ms |

2つの数字は測っている範囲が違うので、直接の優劣にはなりません。SafeQLのlintとtscは別工程で、typed-sqlの`checkFile`はSQL解析・型挿入・tscを1回で行います。

### typed-sqlの変換結果をTS 6.0.3で検査した結果

typed-sqlの`checkFile()`はTypeScript 7.0.2でしか実行できません（`@typed-sql/compiler`のREADME）。一方、SDKはTypeScript 6.0.3です。この制約が変換そのものにも及ぶのかを確かめるため、`compileSource()`が出力した変換済みソースを、TypeScript 6.0.3の`tsc`で検査しました（一時ファイルのみで、結果は保存していません）。

| ケース                                                    | TS 6.0.3での結果                                                                        |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| scalars・left-join・inner-join・parameters・typed-enum-ok | エラーなし                                                                              |
| wrong-parameter                                           | `TS2345: Argument of type 'string' is not assignable to parameter of type 'num...`      |
| wrong-enum                                                | `TS2345: Argument of type '"OWNER"' is not assignable to parameter of type '"ADMIN"...` |
| typed-parameter-wrong・typed-enum-wrong                   | `TS2345`（`string`型の変数を渡した箇所）                                                |
| unsafe-null                                               | `TS18047: 'row.title' is possibly 'null'.`                                              |

TS 7版の結果と同じ診断になりました。TS 7が必須なのは`checkFile()`がtscを起動する部分だけで、`compileSource()`の変換結果はTS 6.0.3で検査できます。ただしその場合、SDK側が`compileSource()`の呼び出しと`tsc`の起動を自前で持つことになります。

### 他に検討した候補

| 候補                       | 入力と出力                                                       | 確認した状況                                                                                             | 外した理由                                                                                  |
| -------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| typed-sql                  | TS内のテンプレート、スナップショット                             | メンテナ1人、npmの最終公開は2026-09-03                                                                   | 継続性への不安                                                                              |
| Prisma TypedSQL            | 別ファイルの`.sql`から生成、実DB必須                             | 単体パッケージなし（`@prisma/typedsql`はnpmに存在しない）                                                | Prisma Client前提で、SDKのKysely・`tailordb.Client`の実行経路と合わない                     |
| pgtyped                    | `.sql`またはTS内のSQLから生成、実PostgreSQL必須                  | 3,285 star、リポジトリは2026-10-05まで更新、npmの最終公開は2025-03-15                                    | リリースが1年半止まっている。READMEで`typescript`をpeer依存にしており、TS 7との関係は未確認 |
| sqlc + sqlc-gen-typescript | 別ファイルの`query.sql`と`schema.sql`から生成。DDLのみで静的解析 | sqlc本体は18,346 starで活発。TSプラグインはREADMEが「Here be dragons」と警告し、最終コミットは2024-11-26 | TSプラグインが長期間止まっている                                                            |
| typesql                    | `.sql`から生成                                                   | 2026-10-06まで更新。READMEはPostgreSQLを「Experimental」と明記                                           | PostgreSQLが実験的                                                                          |

SQLの検証をDDLだけで静的に行う点ではsqlcが近い選択肢ですが、TypeScript向けプラグインが止まっているため、現時点では候補になりません。

## 制限

- DBへの接続は組み込みPGliteのみで、TailorDBには接続していません。
- `schema.mjs`と`run.mjs`は、SDKパッケージが公開していない内部モジュール（`packages/sdk/src/configure`・`parser/service/tailordb`）を相対パスで直接importしています。このディレクトリはルートの`pnpm-workspace.yaml`に含まれず、リポジトリ標準のCIからは実行されないため、内部ファイルが移動・変更されても気づかれずに壊れる可能性があります。
- 配列とnestedフィールドは、DDL生成時に拒否します。
- 上の判断は、このPoCの小さなスキーマ（Account・Project）で確認した範囲です。
