# Migration Version とプラグイン生成リソースの不整合修正

## 問題

`TAILOR_INTERNAL_APPLY_MIGRATION_VERSION` 環境変数を使用して特定の migration version を適用する際、TailorDB types は指定された version に制限されるが、以下のリソースは制限されない:

1. **gqlPermissions** - 存在しないタイプの permissions を作成しようとして失敗
2. **relation fields** - plugin が extends で追加した relation が、存在しないタイプを参照して失敗

## 再現手順

### gqlPermission の問題

1. プラグインが gqlPermission を持つタイプを生成する
2. `TAILOR_INTERNAL_APPLY_MIGRATION_VERSION: "0000"` で apply を実行
3. エラー: `Failed to create TailorDBGQLPermission: failed to create gqlPermission: record not found`

### relation field の問題

1. プラグインが extends で既存タイプに relation フィールドを追加する
2. その relation がプラグイン生成タイプを参照する
3. `TAILOR_INTERNAL_APPLY_MIGRATION_VERSION: "0000"` で apply を実行
4. エラー: `RefType "UserChangeRequest" specified in "User"."userChangeRequests" is not found`

## 発生箇所

Apply workflow の "Apply initial migration (0000)" ステップ:

```yaml
- name: Apply initial migration (0000)
  run: pnpm run apply
  env:
    TAILOR_INTERNAL_APPLY_MIGRATION_VERSION: "0000"
```

## 原因

`packages/sdk/src/cli/apply/services/tailordb/` の apply ロジックで:

- TailorDB types は migration version に基づいてフィルタリングされる
- gqlPermissions はフィルタリングされず、全てのタイプの permissions を作成しようとする

## 期待される動作

`TAILOR_INTERNAL_APPLY_MIGRATION_VERSION` が設定されている場合、gqlPermissions も同じ migration version に基づいてフィルタリングされるべき。

migration version 0000 に存在しないタイプ（例: プラグイン生成タイプ）の gqlPermissions は作成されないべき。

## 調査対象ファイル

- `packages/sdk/src/cli/apply/services/tailordb/index.ts`
- `packages/sdk/src/cli/apply/services/tailordb/gql-permission.ts` (存在する場合)
- migration version フィルタリングを行っている箇所

## 参考: 成功/失敗の比較

### 成功例 (soft-delete plugin)

`Deleted_Customer` タイプは生成されるが、gqlPermission は定義されていない:

```
TailorDB types:
  + Customer
  + Deleted_Customer  (plugin生成)
  ...

TailorDB gqlPermissions:
  + Customer
  ...
  (Deleted_Customer は含まれない)
```

### 失敗例 (changeset plugin)

`UserChangeRequest` タイプは migration 0000 で作成されないが、gqlPermission は作成しようとする:

```
TailorDB types:
  + Customer
  + User
  ...
  (UserChangeRequest は migration 0000 では作成されない)

TailorDB gqlPermissions:
  + Customer
  + User
  + UserChangeRequest  ← 存在しないタイプの permission を作成しようとして失敗
  ...
```

## 関連 PR

- #560 (feat/plugin-changeset-example) - この問題により Apply が失敗
