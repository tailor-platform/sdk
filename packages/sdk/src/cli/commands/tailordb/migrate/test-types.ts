import type {
  TailorDBMigrationTestBaseline,
  TailorDBMigrationTestSnapshots,
} from "#/cli/commands/deploy/types";
import type { ScriptInvoker } from "#/cli/shared/script-executor";

type MigrationTestDataMode = "seed" | "clone";

export interface MigrationTestOptions {
  configPath?: string | undefined;
  workspaceId?: string | undefined;
  profile?: string | undefined;
  data: MigrationTestDataMode;
  targetWorkspaceId?: string | undefined;
  keep?: boolean | undefined;
  keepTtl?: string | undefined;
  organizationId?: string | undefined;
  folderId?: string | undefined;
  assertionPath?: string | undefined;
  assertionNamespace?: string | undefined;
  machineUser?: string | undefined;
  cloneTimeout?: number | undefined;
  yes?: boolean | undefined;
  json?: boolean | undefined;
}

type MigrationTestBaseline = TailorDBMigrationTestBaseline;

export interface PreparedAssertion {
  namespace: string;
  invoker: ScriptInvoker;
}

export interface PreparedMigrationTest {
  assertion?: PreparedAssertion | undefined;
  sourceWorkspaceId: string;
  sourceApplicationName: string;
  temporaryWorkspace: {
    name: string;
    region: string;
    organizationId?: string | undefined;
    folderId?: string | undefined;
  };
  baselines: ReadonlyMap<string, MigrationTestBaseline>;
  baselineSnapshots: TailorDBMigrationTestSnapshots;
  targetSnapshots: TailorDBMigrationTestSnapshots;
  pendingNamespaces: string[];
  designatedTarget?:
    | {
        id: string;
        region: string;
      }
    | undefined;
}

interface MigrationTestWorkspace {
  id: string;
  name: string;
  createdAt?: Date | undefined;
}

interface MigrationTestTarget {
  prepared: PreparedMigrationTest;
  targetWorkspaceId: string;
}

interface MigrationTestDataTarget extends MigrationTestTarget {
  sourceWorkspaceId: string;
  applicationName: string;
  cloneTimeout?: number | undefined;
}

interface MigrationTestScriptTarget extends MigrationTestTarget {
  machineUser?: string | undefined;
}

interface MigrationTestAssertionTarget extends MigrationTestTarget {
  assertionPath: string;
  assertion: PreparedAssertion;
}

export interface MigrationTestDependencies {
  prepare(options: MigrationTestOptions): Promise<PreparedMigrationTest>;
  createWorkspace(prepared: PreparedMigrationTest): Promise<MigrationTestWorkspace>;
  recordWorkspaceExpiry(workspaceId: string, ttl: string, createdAt?: Date): Promise<void>;
  deployBaseline(target: MigrationTestTarget): Promise<void>;
  seedData(target: MigrationTestDataTarget): Promise<void>;
  cloneData(target: MigrationTestDataTarget): Promise<void>;
  deployMigrations(target: MigrationTestScriptTarget): Promise<void>;
  runAssertion(target: MigrationTestAssertionTarget): Promise<void>;
  deleteWorkspace(workspaceId: string): Promise<void>;
}

export interface MigrationTestResult {
  success: true;
  workspaceId: string;
  workspaceName?: string | undefined;
  temporary: boolean;
  deleted: boolean;
  data: MigrationTestDataMode;
  pendingNamespaces: string[];
}
