# Upstream Tooling Issues (vinfer / zinfer)

Findings from reviewing the Zod -> Valibot migration, recorded here so the reports
survive the session that produced them. Everything below was reproduced against a
standalone sandbox project, never against this repository, so each instruction can
be handed to a coding agent working on the upstream repository as-is.

Verified against `valibot@1.4.2` / `vinfer@0.1.2` / `zod@4.4.3` / `zinfer@0.2.8` and
`zinfer@0.3.0`.

| #   | Tool   | Issue                                                                   | Status        |
| --- | ------ | ----------------------------------------------------------------------- | ------------- |
| 1   | vinfer | Recursion inlines one redundant level before self-referencing           | open          |
| 2   | vinfer | `v.description` TSDoc dropped in that inlined level                     | open          |
| 3   | vinfer | Generated types not referenced through a non-generated intermediate     | open          |
| 4   | vinfer | `\| undefined` doubled when an annotation type spells it explicitly     | open          |
| 5   | vinfer | Relative import paths in annotation types not rebased to `outDir`       | open          |
| 6   | zinfer | Same as 3 (both same-file-via-intermediate and cross-file)              | open in 0.3.0 |
| 7   | zinfer | `Input` type collapses to `unknown` through a `z.ZodType<T>` annotation | open in 0.3.0 |

Issue 3 and 6 are the same defect in both tools and are the highest impact: they are
what turns a recursive schema into `any` wherever it is embedded in another schema.

## What is _not_ an upstream bug

Two things that look like regressions in the generated output were checked and are
correct behaviour:

- **`XInput` no longer aliases `X` for permission types.** zod's `.readonly()` marks
  the _input_ type readonly as well (verified: assigning `{ a: readonly string[] }` to
  `z.input<typeof schema>` compiles), so zinfer's `IdPPermissionInput = IdPPermission`
  was faithful to zod. Valibot leaves the input mutable, so vinfer is right to emit
  both in full. `mergeSame` still collapses genuinely identical pairs.
- **`type: string` in the generated field types.** That comes from this repository's
  own `TailorDBFieldOutput.type` declaration, not from either generator. See the open
  task at the end of this document.

## vinfer

Issues 1, 2 and 3 all show up in a single reproduction file; 4 and 5 need a type
annotation and are covered separately in the instruction below.

````markdown
# vinfer の型生成を修正する

対象リポジトリ: https://github.com/toiroakr/vinfer （検証は v0.1.2）

再帰スキーマ、および生成済み型の参照まわりに3つの欠陥がある。
1つの再現ファイルで3つとも同時に観察できる。末尾に別系統の欠陥を2つ追記した。

## 再現手順

```
mkdir -p repro/src/one && cd repro
npm init -y && npm i valibot@1.4.2 vinfer@0.1.2
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "esnext",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "vinfer.config.ts"]
}
```

`vinfer.config.ts`:

```ts
import { defineConfig } from "vinfer";
export default defineConfig({
  project: "./tsconfig.json",
  include: ["src/**/schema.ts"],
  outDir: "./out",
  outPattern: "[dir].generated[ext]",
  suffix: "Schema",
  inputSuffix: "Input",
  outputSuffix: "",
  mergeSame: true,
  withDescriptions: true,
  generateTests: false,
});
```

`src/one/schema.ts`:

```ts
import * as v from "valibot";

export interface NodeShape {
  name: string;
  children: Record<string, NodeShape>;
}

export const NodeSchema = v.object({
  name: v.pipe(v.string(), v.description("The node name")),
  get children(): v.GenericSchema<Record<string, NodeShape>> {
    return v.record(v.string(), NodeSchema);
  },
});

// 未 export なので vinfer はこれに対応する型を生成しない
const GroupSchema = v.object({
  members: v.array(NodeSchema),
});

export const TreeSchema = v.object({
  direct: v.pipe(NodeSchema, v.description("Depth 1: direct reference")),
  viaGroup: v.pipe(GroupSchema, v.description("Depth 2: through a non-generated schema")),
});
```

`npx vinfer` を実行すると `out/one.generated.ts` は次を出力する。

```ts
export type Node = {
  /** The node name */
  name: string;
  children: {
    [x: string]: {
      // <- 欠陥1: この階層はまるごと不要
      name: string; // <- 欠陥2: TSDoc が消えている
      children: {
        [x: string]: Node;
      };
    };
  };
};

export type Tree = {
  /** Depth 1: direct reference */
  direct: Node; // <- 正しい
  /** Depth 2: through a non-generated schema */
  viaGroup: {
    members: {
      // <- 欠陥3: Node[] を参照すべき
      /** The node name */
      name: string;
      children: {
        [x: string]: {
          name: string;
          children: any; // <- 索引シグネチャすら失われている
        };
      };
    }[];
  };
};
```

## 欠陥1 — 自己参照の前に同じ形を1階層余計にインライン展開する

`Node.children` は `{ [x: string]: Node }` を直接出すべき。
再帰点を検出したら、1階層展開してからではなく即座に自己参照を出すこと。

期待する出力:

```ts
export type Node = {
  /** The node name */
  name: string;
  children: {
    [x: string]: Node;
  };
};
```

## 欠陥2 — インライン展開された階層で `v.description` の TSDoc が落ちる

上の出力で深さ0の `name` には `/** The node name */` が付くが、深さ1の
インラインコピーには付かない。欠陥1を直せばこの階層自体が消えるが、
`withDescriptions` はインライン展開されたどの階層でも一貫して
適用されるべきなので、回帰テストを別途足すこと。

## 欠陥3 — 型が生成されない中間スキーマを経由すると生成済み型を参照しなくなる（最優先）

`direct: Node` が正しく出ているとおり、参照の仕組み自体は存在する。
しかし `GroupSchema`（型が生成されない）を1つ挟んだだけで参照をやめて
構造をインライン展開し、その中で再帰が `any` に潰れる。

期待する出力:

```ts
export type Tree = {
  /** Depth 1: direct reference */
  direct: Node;
  /** Depth 2: through a non-generated schema */
  viaGroup: {
    members: Node[];
  };
};
```

中間スキーマをインライン展開したあとも、その内側で生成済み型の参照を
続けられるようにすること。

### 同じ欠陥のファイル境界版

`NodeSchema` を `src/node/schema.ts` に、`TreeSchema` を
`src/tree/schema.ts` に分けると、`out/node.generated.ts` に `Node` が
正しく生成されているにもかかわらず `out/tree.generated.ts` はこう出す:

```ts
export type Tree = {
  /** Root node */
  root: {
    /** The node name */
    name: string;
    children: {
      [x: string]: {
        name: string;
        children: any;
      };
    };
  };
};
```

`import type { Node } from "./node.generated";` を出して `root: Node` と
参照すること。同一ファイル内の直接参照は既に動いているので、
出力ファイルをまたぐ場合と中間スキーマを挟む場合の両方で
同じ参照解決を働かせるのが修正の要点。

クロスファイル import の実装が難しい場合でも、最低限 `any` ではなく
`{ [x: string]: any }` に落とすこと。索引シグネチャを失うと
プロパティアクセスの型チェックが一切効かなくなる。

## 欠陥4 — `| undefined` が二重に付く

valibot のスキーマ構成ではなく `v.GenericSchema<T>` の型注釈が引き金。
次の3条件が同時に揃ったときだけ発生する。

1. 注釈に使う型のオプショナルプロパティが、明示的に `| undefined` と書かれている
   （`required?: boolean` ではなく `required?: boolean | undefined`）
2. スキーマ定数に `v.GenericSchema<その型>` の注釈が付いている
3. その注釈付きスキーマが自身の型として出力されず、別のスキーマにインライン
   展開される（未 export など）

`src/one/types.ts`:

```ts
export type Meta = {
  required?: boolean | undefined;
  label?: string | undefined;
};

export type NodeShape = {
  kind: string;
  meta: Meta;
};
```

`src/one/schema.ts`:

```ts
import * as v from "valibot";
import type { NodeShape } from "./types";

// 未 export: vinfer はこれに対応する型を出さないので TreeSchema にインライン展開される
const NodeSchema: v.GenericSchema<NodeShape> = v.object({
  kind: v.string(),
  meta: v.object({
    required: v.optional(v.boolean()),
    label: v.optional(v.string()),
  }),
});

export const TreeSchema = v.object({
  node: NodeSchema,
});
```

実際の出力:

```ts
export type Tree = {
  node: {
    kind: string;
    meta: {
      required?: boolean | undefined | undefined;
      label?: string | undefined | undefined;
    };
  };
};
export type TreeInput = Tree;
```

期待する出力は `required?: boolean | undefined;` / `label?: string | undefined;`。

条件を切り分けたコントロール:

| #   | 変更点                                                                               | 結果         |
| --- | ------------------------------------------------------------------------------------ | ------------ |
| A   | 上記のまま                                                                           | 二重化する   |
| B   | `types.ts` を `required?: boolean; label?: string;` に（明示 `\| undefined` を外す） | 二重化しない |
| C   | `NodeSchema` を `export` する（自身の型が生成される）                                | 二重化しない |
| D   | `v.GenericSchema<NodeShape>` の注釈を外す（`types.ts` も不要に）                     | 二重化しない |

TypeScript の型として `boolean | undefined | undefined` は存在しない
（union は正規化されるため）。したがってこの出力は、解決済みの型を
プリンタに1回通した結果ではありえず、書かれたままの型ノード（AST）を
出力した文字列に、オプショナル描画側が別途 `| undefined` を足している
経路が存在するはず。コントロール B が決定的で、二重化するかどうかが
「注釈型のソースに `| undefined` と書かれているか」だけで決まる。

## 欠陥5 — 注釈型の相対 import パスが出力先基準に直らない

欠陥4のコントロール C（`NodeSchema` を export した状態）の出力には
`import("./types").Meta` が含まれるが、この `./types` はソース
（`src/one/`）基準のままで、出力先（`out/`）からは解決できない。

```
$ npx tsc --noEmit --strict --ignoreConfig out/one.generated.ts
out/one.generated.ts(5,16): error TS2307: Cannot find module './types' or its
corresponding type declarations.
```

注釈型の import 指定子を出力ディレクトリ基準に貼り直す必要がある。
パスエイリアス（`#/foo/types` 等）を使っているプロジェクトでは出力先に
関係なく解決できてしまうため露見しにくく、相対パスのときだけ壊れる。

## 受け入れ条件

- 上記 repro で欠陥1〜5の期待出力が得られること
- 生成された型が `tsc --noEmit --strict` を通ること
- 以下を回帰テストとして追加すること:
  - 必須キーでの自己参照再帰（`children: Record<string, Self>`）
  - オプショナルキーでの自己参照再帰（`children?: Record<string, Self>`）
  - 型が生成されないスキーマを経由した参照
  - 別出力ファイルにあるスキーマへの参照
  - 上記それぞれで `v.description` が全階層に付くこと
  - 明示 `| undefined` を持つ注釈型のインライン展開
  - 相対パスで import された注釈型を含む生成ファイルが単体で型チェックを通ること
- 既存の `mergeSame` の挙動を壊さないこと。Input と Output が構造的に同一の
  ときは `type XInput = X` を出し続けること（`v.readonly()` などで実際に
  異なるときは別々に出すのが正しい）
````

## zinfer

zinfer is no longer used by this repository, but the same author maintains it and
`0.3.0` shipped alongside the valibot tooling, so the findings are worth passing on.
Both defects below reproduce on `0.2.8` (what this repository pinned) and `0.3.0`.

````markdown
# zinfer: 生成済み型を参照せずインライン展開してしまう問題を修正する

対象リポジトリ: https://github.com/toiroakr/zinfer
検証: zinfer 0.2.8 および 0.3.0 / zod 4.4.3（3件とも 0.3.0 で未修正）

zinfer は、あるスキーマを直接参照している場合は生成済みの型名を正しく使う。
しかし参照経路に「型が生成されないスキーマ」が1つでも挟まると型名の参照をやめて
構造をインライン展開し、その展開されたコピーの中で再帰が `any` に潰れる。

## 共通セットアップ

```
mkdir repro && cd repro && npm init -y
npm i zod@4.4.3 zinfer@0.3.0
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "esnext",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "zinfer.config.ts"]
}
```

`zinfer.config.ts`:

```ts
import { defineConfig } from "zinfer";
export default defineConfig({
  project: "./tsconfig.json",
  include: ["src/**/schema.ts"],
  outDir: "./out",
  outPattern: "[dir].generated[ext]",
  suffix: "Schema",
  inputSuffix: "Input",
  outputSuffix: "",
  mergeSame: true,
  withDescriptions: true,
  generateTests: false,
});
```

## 欠陥1 — 型が生成されない中間スキーマを挟むとインライン展開に落ちる（最優先）

`src/one/schema.ts`:

```ts
import { z } from "zod";

export const NodeSchema = z.strictObject({
  name: z.string().describe("The node name"),
  get children() {
    return z.record(z.string(), NodeSchema);
  },
});

// 未 export なので zinfer はこれに対応する型を生成しない
const GroupSchema = z.strictObject({
  members: z.array(NodeSchema),
});

export const TreeSchema = z.strictObject({
  direct: NodeSchema.describe("Depth 1: direct reference"),
  viaGroup: GroupSchema.describe("Depth 2: through a non-generated schema"),
});
```

実際の出力:

```ts
export type Tree = {
  /** Depth 1: direct reference */
  direct: Node; // <- 正しい
  /** Depth 2: through a non-generated schema */
  viaGroup: {
    members: {
      // <- Node[] を参照すべき
      /** The node name */
      name: string;
      children: {
        [x: string]: any; // <- 再帰が any に潰れている
      };
    }[];
  };
};
```

期待する出力:

```ts
export type Tree = {
  /** Depth 1: direct reference */
  direct: Node;
  /** Depth 2: through a non-generated schema */
  viaGroup: {
    members: Node[];
  };
};
```

`direct` が `Node` になっているとおり参照の仕組み自体は存在する。中間スキーマを
インライン展開したあと、その内側でも生成済み型の参照を続けられるようにすること。

## 欠陥2 — 別の出力ファイルにあるスキーマも同様（欠陥1と同根の可能性が高い）

`src/node/schema.ts` に `NodeSchema` を、`src/tree/schema.ts` に
`TreeSchema = z.object({ root: NodeSchema, index: z.record(z.string(), NodeSchema) })`
を置くと、`out/node.generated.ts` に `Node` が正しく生成されているにもかかわらず
`out/tree.generated.ts` は次を出す:

```ts
export type Tree = {
  root: {
    name: string;
    children: { [x: string]: any };
  };
  index: { [x: string]: any };
};
```

`import type { Node } from "./node.generated";` を出して参照すること。

## 欠陥3 — `z.ZodType<T>` 注釈付きスキーマを参照すると Input 型が `unknown` になる

`src/annot/schema.ts`:

```ts
import { z } from "zod";

export interface NodeShape {
  name: string;
  children: Record<string, NodeShape>;
}

export const NodeSchema: z.ZodType<NodeShape> = z.lazy(() =>
  z.object({
    name: z.string().describe("The node name"),
    children: z.record(z.string(), NodeSchema),
  }),
);

export const TreeSchema = z.object({
  root: NodeSchema.describe("Root node"),
});
```

実際の出力:

```ts
export type Node = import("../src/annot/schema").NodeShape;
export type NodeInput = Node;

export type TreeInput = {
  /** Root node */
  root: unknown; // <- Output 側は Node なのに Input 側だけ壊れる
};

export type Tree = {
  /** Root node */
  root: Node; // <- 正しい
};
```

`TreeInput.root` は `NodeInput` になるべき。Output 側の解決パスは動いているので、
Input 側だけ注釈付きスキーマの解決に失敗している。

## 受け入れ条件

- 欠陥1〜3の期待出力が得られること
- 生成型が `tsc --noEmit --strict` を通ること
- 回帰テストを追加すること:
  - 型が生成されないスキーマを経由した参照（欠陥1）
  - 別出力ファイルにあるスキーマへの参照（欠陥2）
  - `z.ZodType<T>` 注釈付きスキーマの Input / Output 両方（欠陥3）
- 直接参照（`direct: Node`）と同一ファイル内参照の既存挙動を壊さないこと。
  これらは現状すべて正しく動いている
````

## Open task in this repository: narrow `TailorDBFieldOutput.type`

Not an upstream issue. Verified safe but left unapplied because it narrows a type
that reaches plugin authors through `./plugin` (`PluginManager` exposes
`TailorDBTypeRaw`), so a plugin that _constructs_ one of these objects with a plain
`string` would stop compiling. Reading code is unaffected and gets strictly better
types. Whether that trade is worth making is a call for the SDK owners.

`packages/sdk/src/parser/service/tailordb/types.ts` declares:

```ts
export type TailorDBFieldOutput = {
  type: string;
  fields?: Record<string, TailorDBFieldOutput>;
  metadata: DBFieldMetadataGenerated;
  rawRelation?: RawRelationConfigGenerated;
};
```

That type annotates `TailorDBFieldSchema` in `parser/service/tailordb/schema.ts`, and
vinfer reads the annotation rather than the schema, so the 11-literal union in
`TailorFieldTypeSchema` never reaches the generated types.

Narrowing `type` to the same 11 literals `TailorFieldShape.type` already spells out in
`parser/service/field/schema.ts` changes exactly three generated sites:

- `types/tailordb.generated.ts` - `TailorDBTypeRawInput.fields[x].type`
- `types/tailordb.generated.ts` - `TailorDBTypeRaw.fields[x].type`
- `types/auth.generated.ts` - `AuthConfig.userProfile.type.fields[x].type`

`RawRelationConfig.toward.type` and `TenantProvider.type` are also `string` in the
generated output, but those are genuinely `v.string()` and must not be touched.

Verified: after editing the declaration and running `pnpm -C packages/sdk run generate`,
only those three sites change and `pnpm -w run check:typecheck` passes with zero errors
across the workspace, including the `example` project.

`types.ts` is a pure type module and cannot import from a schema module, so the
literals have to be written out. That makes a third copy of the same list (the other
two are in `parser/service/tailordb/schema.ts` and `parser/service/field/schema.ts`);
de-duplicating them needs a home that satisfies the pure-type-module constraints and
should be considered separately.
