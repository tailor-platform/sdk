# TailorDB関連定義インターフェース改善計画

## 概要

現在のTailorDBの関連定義で使用されている`ref().unique()`パターンを、より直感的で理解しやすい`relation()`メソッドに全面置き換えします。

## 現在の課題

### 問題点

- **直感性の欠如**: `unique()`の有無で1:1/1:N関連を判断するのが分かりにくい
- **ヒューマンエラー**: uniqueの付け忘れが頻発する
- **学習コスト**: 新しい開発者が仕組みを理解するのに時間がかかる
- **コードレビューの負担**: unique付け忘れの指摘が多い

### 現在のコード例

```typescript
// 1:1関連（理解しにくい）
userID: db.uuid().ref(user, ["user", "setting"]).unique();

// 1:N関連（unique有無の違いが分からない）
supplierID: db.uuid().ref(supplier, ["supplier", "purchaseOrders"]);
```

## 新しいインターフェース仕様

### 基本構文

```typescript
db.uuid().relation({
  type: "oneToOne" | "oneToMany",
  toward: [参照先テーブル, "参照元から見た名前"],
  backward: "逆方向の関連名",
});
```

### 具体例

```typescript
// 1:1関連（明確で理解しやすい）
userID: db.uuid().relation({
  type: "oneToOne",
  toward: [user, "user"], // userテーブルを"user"として参照
  backward: "setting", // userから見た時は"setting"
});

// 1:N関連（関連の種類が明確）
supplierID: db.uuid().relation({
  type: "oneToMany",
  toward: [supplier, "supplier"],
  backward: "purchaseOrders",
});
```

## 実装計画

### フロー図

```mermaid
flowchart TD
    A[Step 1: 型定義とインターフェース] --> B[Step 2: relation()メソッド実装]
    B --> C[Step 3: 既存ref/uniqueメソッド削除]
    C --> D[Step 4: 全TailorDBファイル変換]
    D --> E[Step 5: テスト実行・検証]

    A --> A1[RelationConfig型定義]
    A --> A2[TypeScript型安全性確保]

    B --> B1[TailorDBField.relation実装]
    B --> B2[内部でref/unique相当の処理]
    B --> B3[メタデータ処理更新]

    D --> D1[userSetting.ts]
    D --> D2[purchaseOrder.ts]
    D --> D3[salesOrder.ts]
    D --> D4[その他TailorDBファイル]

    E --> E1[turbo run test]
    E --> E2[turbo run check]
    E --> E3[動作確認]
```

### Step 1: 型定義追加

**ファイル**: `packages/tailor-sdk/src/services/tailordb/schema.ts`

```typescript
interface RelationConfig<T> {
  type: "oneToOne" | "oneToMany";
  toward: [T, string]; // [参照先テーブル, 参照元から見た名前]
  backward: string; // 逆方向の関連名
}
```

### Step 2: relationメソッド実装

```typescript
relation<T, Config extends RelationConfig<T>>(
  config: Config
): TailorDBField<CurrentDefined, Output, RelationReference<Config>> {
  // 内部的に既存のref().unique()相当の処理を実行
  const [targetTable, forwardName] = config.toward
  const relationNames = [forwardName, config.backward]

  if (config.type === "oneToOne") {
    // 1:1関連の場合はunique制約を適用
    return this.ref(targetTable, relationNames).unique()
  } else {
    // 1:N関連の場合はそのまま
    return this.ref(targetTable, relationNames)
  }
}
```

### Step 3: 既存メソッド削除

- `TailorDBField.ref()`メソッドの削除
- `TailorDBField.unique()`メソッドの削除
- 関連する型定義の更新

### Step 4: 全TailorDBファイル変換

#### 対象ファイル

- `src/tailordb/userSetting.ts` - 1:1関連の例
- `src/tailordb/purchaseOrder.ts` - 1:N関連の例
- `src/tailordb/salesOrder.ts` - 1:N関連の例
- その他のTailorDBファイル

#### 変換例

**userSetting.ts**

```typescript
// 変換前
userID: db.uuid().ref(user, ["user", "setting"]).unique();

// 変換後
userID: db.uuid().relation({
  type: "oneToOne",
  toward: [user, "user"],
  backward: "setting",
});
```

**purchaseOrder.ts**

```typescript
// 変換前
supplierID: db.uuid().ref(supplier, ["supplier", "purchaseOrders"]);

// 変換後
supplierID: db.uuid().relation({
  type: "oneToMany",
  toward: [supplier, "supplier"],
  backward: "purchaseOrders",
});
```

### Step 5: テスト・検証

#### 検証手順

1. **コンパイル確認**: TypeScript型エラーがないことを確認
2. **テスト実行**: `turbo run test`で既存機能が正常動作することを確認
3. **品質チェック**: `turbo run check`でlint/format/型チェックを実行
4. **生成物確認**: 新しいAPIでも同じCUEマニフェストが生成されることを確認

#### 成功基準

- [ ] 全てのTypeScriptコンパイルエラーが解消されている
- [ ] `turbo run test`が成功する
- [ ] `turbo run check`が成功する
- [ ] 生成されるCUEマニフェストが変更前と同一である
- [ ] GraphQL SDLの生成に問題がない

## 期待効果

### 開発者体験の改善

- **直感性向上**: 関連の種類が`type`プロパティで明確に分かる
- **エラー削減**: TypeScriptの型システムでミスを防げる
- **学習コスト削減**: 新しい開発者が理解しやすい
- **コードレビュー効率化**: 関連定義のミスを発見しやすい

### コード品質向上

- **型安全性**: TypeScriptで関連定義のミスをコンパイル時に検出
- **一貫性**: 統一されたインターフェースで関連を定義
- **可読性**: コードの意図が明確に表現される

## 実装後の維持管理

- 新しい`relation()`メソッドのみを使用
- `ref()`や`unique()`メソッドは完全に削除
- 型定義とドキュメントの整備
- 開発ガイドラインの更新

---

**作成日**: 2025/7/1
**ステータス**: 実装準備完了
