import * as fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { trimSDKCode } from "./utils";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

describe("trimSDKCode", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("keeps class definitions that only reference removed imports via properties", () => {
    const source = /* js */ `
import { createExecutor, db } from "@tailor-platform/tailor-sdk";

class JobRepositoryImpl {
  constructor(db) {
    this.db = db;
  }

  async changeJobStatus(id, status) {
    return this.db.update(id, status);
  }
}

const dummyTrigger = { manifest: {}, context: {} };
const executor = createExecutor("execute-job", "desc")
  .on(dummyTrigger)
  .executeFunction({
    fn: async ({ newRecord }) => {
      const repo = new JobRepositoryImpl({ update: async () => {} });
      await repo.changeJobStatus(newRecord.id, "IN_PROGRESS");
    },
  });

export default executor;
`;

    const fsMock = vi.mocked(fs);
    fsMock.readFileSync.mockReturnValue(source);
    const file = "/tmp/trim-sdk-test/executor.js";
    const trimmed = trimSDKCode(file);

    console.log(trimmed);
    expect(trimmed).toContain("class JobRepositoryImpl");
    expect(trimmed).toContain("this.db = db;");
    expect(trimmed).not.toContain("@tailor-platform/tailor-sdk");
    expect(trimmed).not.toContain("createExecutor");
    expect(trimmed).not.toContain("export default");
  });
});
