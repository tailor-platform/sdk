# defineConfig / erdSite 型制約の変更メモ

このファイルは、`defineConfig` の型周りの変更内容を記録するためのメモです。

## 変更ファイル

- `packages/sdk/src/configure/config.ts`

## 変更内容の概要

- `defineConfig` の引数型を調整し、`staticWebsites` に渡した静的サイト配列から ERD 用サイト名 (`erdSite`) の型をリテラルとして推論・制約するようにした。
- `staticWebsites` がない場合の挙動や他フィールド（`auth` など）の推論には影響を与えないよう、`AppConfig` 本体はほぼ従来どおりに保ちつつ、`db` の型だけを引数側で上書きする構成にしている。

## 変更前の `defineConfig` 型定義（概要）

- 元々の公開シグネチャは次のとおり:

  ```ts
  export interface AppConfig<
    Auth extends AuthConfig = AuthConfig,
    Idp extends IdPConfig[] = IdPConfig[],
    StaticWebsites extends StaticWebsiteConfig[] = StaticWebsiteConfig[],
    Env extends Record<string, string | number | boolean> = Record<string, string | number | boolean>,
  > {
    // ...
    db?: TailorDBServiceInput;
    staticWebsites?: StaticWebsites;
  }

  export function defineConfig<
    const Config extends AppConfig &
      Record<Exclude<keyof Config, keyof AppConfig>, never>,
  >(config: Config): Config;
  ```

- `TailorDBServiceInput` はジェネリックではなく、`erdSite` は常に `string | undefined` 扱いのため、`staticWebsites` の情報が `erdSite` の型に伝播していなかった。

## 変更後の `defineConfig` 型定義（概要）

- `AppConfig` 自体はほぼそのまま（一点だけ `StaticWebsites` を `readonly StaticWebsiteConfig[]` に変更）とし、`db` の型は引数側で上書きする:

  ```ts
  export interface AppConfig<
    Auth extends AuthConfig = AuthConfig,
    Idp extends IdPConfig[] = IdPConfig[],
    StaticWebsites extends readonly StaticWebsiteConfig[] = StaticWebsiteConfig[],
    Env extends Record<string, string | number | boolean> = Record<string, string | number | boolean>,
  > {
    // ...
    db?: TailorDBServiceInput;
    staticWebsites?: StaticWebsites;
  }
  ```

- `staticWebsites` から名前だけを抜き出すユーティリティ型を追加:

  ```ts
  type StaticWebsiteNames<Config extends AppConfig> =
    Config["staticWebsites"] extends readonly (infer Site)[]
      ? Site extends { name: infer Name extends string }
        ? Name
        : never
      : never;
  ```

- `TailorDBServiceInput` の各エントリに `erdSite` 制約を付与する型を追加:

  ```ts
  type TailorDBServiceInputWithErd<Config extends AppConfig> =
    StaticWebsiteNames<Config> extends never
      ? TailorDBServiceInput
      : {
          [N in keyof TailorDBServiceInput]: TailorDBServiceInput[N] extends { external: true }
            ? TailorDBServiceInput[N]
            : TailorDBServiceInput[N] & { erdSite?: StaticWebsiteNames<Config> };
        };
  ```

- `defineConfig` のシグネチャを次のように変更:

  ```ts
  export function defineConfig<
    const Config extends AppConfig &
      Record<Exclude<keyof Config, keyof AppConfig>, never>,
  >(config: Config & { db?: TailorDBServiceInputWithErd<Config> }): Config {
    return config;
  }
  ```

- これにより:
  - `staticWebsites` がない場合: `StaticWebsiteNames<Config> = never` となり、`TailorDBServiceInputWithErd<Config>` は元の `TailorDBServiceInput` と同じ型になる（制約なし）。
  - `staticWebsites` がある場合: `StaticWebsiteNames<Config>` が `"erd" | "my-frontend" | ...` のようなリテラル集合となり、`db.<namespace>.erdSite` がそのいずれかに制約される。
  - 他のフィールド（`auth` など）の型推論は従来どおり `AppConfig` 経由で行われるため、副作用的な破壊は起きにくい。

## 挙動の確認例

```ts
const erdWebsite = defineStaticWebSite("erd", { /* ... */ });

export default defineConfig({
  name: "hello-world",
  db: {
    // ✅ OK
    tailordb: { files: ["./tailordb/*.ts"], erdSite: "erd" },
    // ❌ 型エラー: Type '"aaaa"' is not assignable to type '"erd"'.
    // tailordb: { files: ["./tailordb/*.ts"], erdSite: "aaaa" },
  },
  staticWebsites: [erdWebsite],
});
```

このように、`erdSite` が `staticWebsites` 内の `name` リテラルに制約されることを確認済み。
