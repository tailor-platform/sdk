import { parseSync } from "oxc-parser";
import { describe, expect, it } from "vitest";
import { findAllJobs, transformWorkflowSource } from "./ast-transformer";

// Note: parseSync is imported here for unit tests of findAllJobs
// transformWorkflowSource uses it internally

describe("AST Transformer - createWorkflowJob呼び出し検出", () => {
  describe("findAllJobs", () => {
    it("createWorkflowJob呼び出しを検出できる", () => {
      const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const job1 = createWorkflowJob({
  name: "job-one",
  body: async () => { return "one"; }
});

const job2 = createWorkflowJob({
  name: "job-two",
  deps: [job1],
  body: async (input, jobs) => {
    return await jobs.jobOne();
  }
});
`;
      const { program } = parseSync("test.ts", source);
      const jobs = findAllJobs(program, source);

      expect(jobs).toHaveLength(2);
      expect(jobs[0].name).toBe("job-one");
      expect(jobs[0].depsRange).toBeUndefined();
      expect(jobs[1].name).toBe("job-two");
      expect(jobs[1].depsRange).toBeDefined();
    });

    it("bodyが関数でないオブジェクトは検出しない", () => {
      const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const notAJob = createWorkflowJob({
  name: "not-a-job",
  body: "string value"
});

const realJob = createWorkflowJob({
  name: "real-job",
  body: async () => {}
});
`;
      const { program } = parseSync("test.ts", source);
      const jobs = findAllJobs(program, source);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].name).toBe("real-job");
    });

    it("nameが文字列リテラルでないオブジェクトは検出しない", () => {
      const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const notAJob = createWorkflowJob({
  name: someVariable,
  body: () => {}
});

const realJob = createWorkflowJob({
  name: "real-job",
  body: async () => {}
});
`;
      const { program } = parseSync("test.ts", source);
      const jobs = findAllJobs(program, source);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].name).toBe("real-job");
    });

    it("bodyValueRangeが正しい位置を返す", () => {
      const source = `import { createWorkflowJob } from "@tailor-platform/sdk";
const job = createWorkflowJob({ name: "test", body: () => { return 42; } });`;
      const { program } = parseSync("test.ts", source);
      const jobs = findAllJobs(program, source);

      expect(jobs).toHaveLength(1);
      const bodyCode = source.slice(
        jobs[0].bodyValueRange.start,
        jobs[0].bodyValueRange.end,
      );
      expect(bodyCode).toBe("() => { return 42; }");
    });

    it("depsRangeが正しい位置を返す", () => {
      const source = `import { createWorkflowJob } from "@tailor-platform/sdk";
const job = createWorkflowJob({ name: "test", deps: [a, b], body: () => {} });`;
      const { program } = parseSync("test.ts", source);
      const jobs = findAllJobs(program, source);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].depsRange).toBeDefined();
      const depsCode = source.slice(
        jobs[0].depsRange!.start,
        jobs[0].depsRange!.end,
      );
      expect(depsCode).toBe("deps: [a, b]");
    });

    describe("偽陽性が発生しないことを確認", () => {
      it("createWorkflowJob以外の関数呼び出しは検出されない", () => {
        const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const notAJob = someOtherFunction({
  name: "not-a-job",
  body: async () => { return "test"; }
});

const realJob = createWorkflowJob({
  name: "real-job",
  body: async () => {}
});
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        // createWorkflowJob呼び出しのみ検出される
        expect(jobs).toHaveLength(1);
        expect(jobs[0].name).toBe("real-job");
      });

      it("createWorkflowJobに渡されないオブジェクトは検出されない", () => {
        const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

// createWorkflowJobには渡されないが、同じパターンを持つオブジェクト
const config = { name: "unused-job", body: async () => {} };

// 別の用途で使われる
doSomethingElse(config);

// 本物のジョブ
const realJob = createWorkflowJob({
  name: "real-job",
  body: async () => {}
});
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        // createWorkflowJob呼び出しのみ検出される
        expect(jobs).toHaveLength(1);
        expect(jobs[0].name).toBe("real-job");
      });

      it("配列内のオブジェクトはcreateWorkflowJob呼び出しでなければ検出されない", () => {
        const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

// createWorkflowJobには使われない配列
const configs = [
  { name: "config-one", body: async () => {} },
  { name: "config-two", body: async () => {} }
];

// 別の用途
processConfigs(configs);
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        // createWorkflowJob呼び出しがないので検出されない
        expect(jobs).toHaveLength(0);
      });
    });

    describe("様々なインポートパターン", () => {
      it("エイリアス付きインポート", () => {
        const source = `
import { createWorkflowJob as create } from "@tailor-platform/sdk";

const job = create({
  name: "job-one",
  body: async () => {}
});
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        expect(jobs).toHaveLength(1);
        expect(jobs[0].name).toBe("job-one");
      });

      it("デフォルトインポート", () => {
        const source = `
import sdk from "@tailor-platform/sdk";

const job = sdk.createWorkflowJob({
  name: "job-one",
  body: async () => {}
});
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        expect(jobs).toHaveLength(1);
        expect(jobs[0].name).toBe("job-one");
      });

      it("名前空間インポート", () => {
        const source = `
import * as sdk from "@tailor-platform/sdk";

const job = sdk.createWorkflowJob({
  name: "job-one",
  body: async () => {}
});
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        expect(jobs).toHaveLength(1);
        expect(jobs[0].name).toBe("job-one");
      });

      it("サブパスからのインポート", () => {
        const source = `
import { createWorkflowJob } from "@tailor-platform/sdk/configure";

const job = createWorkflowJob({
  name: "job-one",
  body: async () => {}
});
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        expect(jobs).toHaveLength(1);
        expect(jobs[0].name).toBe("job-one");
      });

      it("動的インポート", () => {
        const source = `
const sdk = await import("@tailor-platform/sdk");

const job = sdk.createWorkflowJob({
  name: "job-one",
  body: async () => {}
});
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        expect(jobs).toHaveLength(1);
        expect(jobs[0].name).toBe("job-one");
      });

      it("require()", () => {
        const source = `
const { createWorkflowJob } = require("@tailor-platform/sdk");

const job = createWorkflowJob({
  name: "job-one",
  body: async () => {}
});
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        expect(jobs).toHaveLength(1);
        expect(jobs[0].name).toBe("job-one");
      });
    });

    describe("偽陰性（検出できないパターン）", () => {
      it("bodyが関数への参照の場合は検出できない", () => {
        const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

async function myHandler() { return "result"; }

const job = createWorkflowJob({
  name: "my-job",
  body: myHandler
});
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        expect(jobs).toHaveLength(0);
      });

      it("nameが変数の場合は検出できない", () => {
        const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const jobName = "my-job";

const job = createWorkflowJob({
  name: jobName,
  body: async () => {}
});
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        expect(jobs).toHaveLength(0);
      });

      it("スプレッドのみで構成されたオブジェクトは検出できない", () => {
        const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const nameConfig = { name: "my-job" };
const bodyConfig = { body: async () => {} };

const job = createWorkflowJob({ ...nameConfig, ...bodyConfig });
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        expect(jobs).toHaveLength(0);
      });

      it("変数として渡された設定オブジェクトは検出できない", () => {
        const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const config = { name: "my-job", body: async () => {} };

const job = createWorkflowJob(config);
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        // configは変数なので検出できない
        expect(jobs).toHaveLength(0);
      });

      it("変数への再代入後は検出できない", () => {
        const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const create = createWorkflowJob;
const job = create({
  name: "job-one",
  body: async () => {}
});
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        expect(jobs).toHaveLength(0);
      });

      it("名前空間からの分割代入後は検出できない", () => {
        const source = `
import * as sdk from "@tailor-platform/sdk";

const { createWorkflowJob } = sdk;
const job = createWorkflowJob({
  name: "job-one",
  body: async () => {}
});
`;
        const { program } = parseSync("test.ts", source);
        const jobs = findAllJobs(program, source);

        expect(jobs).toHaveLength(0);
      });
    });
  });
});

describe("AST Transformer - 変換ロジック", () => {
  describe("transformWorkflowSource", () => {
    it("ターゲットジョブのdepsを削除する", () => {
      const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const job1 = createWorkflowJob({
  name: "job-one",
  body: () => "one"
});

const job2 = createWorkflowJob({
  name: "job-two",
  deps: [job1],
  body: async (input, jobs) => {
    return await jobs.jobOne();
  }
});
`;
      const result = transformWorkflowSource(source, "job-two");

      // job-twoのdepsが削除されている
      expect(result).not.toMatch(/name: "job-two"[\s\S]*deps:/);
      // job-twoのbodyは残っている
      expect(result).toContain("await jobs.jobOne()");
      // job1の宣言が削除されている
      expect(result).not.toContain("job-one");
    });

    it("他ジョブの宣言を完全に削除する", () => {
      const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const heavyJob = createWorkflowJob({
  name: "heavy-job",
  body: async () => {
    const db = getDB("tailordb");
    return await db.selectFrom("User").execute();
  }
});

const mainJob = createWorkflowJob({
  name: "main-job",
  deps: [heavyJob],
  body: async (input, jobs) => {
    return { result: "main" };
  }
});
`;
      const result = transformWorkflowSource(source, "main-job");

      // heavyJobの宣言が完全に削除されている
      expect(result).not.toContain("heavy-job");
      expect(result).not.toContain("heavyJob");
      // getDBが削除されている
      expect(result).not.toContain("getDB");
      // mainJobのbodyは残っている
      expect(result).toContain('result: "main"');
    });

    it("複数の他ジョブの宣言を削除する", () => {
      const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const job1 = createWorkflowJob({
  name: "job-one",
  body: () => "heavy code 1"
});

const job2 = createWorkflowJob({
  name: "job-two",
  body: () => "heavy code 2"
});

const mainJob = createWorkflowJob({
  name: "main-job",
  deps: [job1, job2],
  body: () => "main"
});
`;
      const result = transformWorkflowSource(source, "main-job");

      // job1, job2の宣言が削除されている
      expect(result).not.toContain("job-one");
      expect(result).not.toContain("job-two");
      // mainJobのbodyは残っている
      expect(result).toContain('"main"');
      // heavy codeが削除されている
      expect(result).not.toContain("heavy code");
    });

    it("depsがないジョブは変更しない", () => {
      const source = `
import { createWorkflowJob } from "@tailor-platform/sdk";

const simpleJob = createWorkflowJob({
  name: "simple-job",
  body: () => "simple"
});
`;
      const result = transformWorkflowSource(source, "simple-job");

      // 変更なし
      expect(result).toContain('"simple"');
    });
  });
});
