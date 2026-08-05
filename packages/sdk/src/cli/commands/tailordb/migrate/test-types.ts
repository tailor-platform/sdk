import type {
  TailorDBMigrationTestBaseline,
  TailorDBMigrationTestSnapshots,
} from "#/cli/commands/deploy/types";

export type MigrationTestDataMode = "seed" | "clone";

export interface MigrationTestOptions {
  configPath?: string;
  workspaceId?: string;
  profile?: string;
  data: MigrationTestDataMode;
  targetWorkspaceId?: string;
  assertionPath?: string;
  assertionNamespace?: string;
  machineUser?: string;
  yes?: boolean;
  json?: boolean;
}

export type MigrationTestBaseline = TailorDBMigrationTestBaseline;

export interface PreparedMigrationTest {
  sourceWorkspaceId: string;
  sourceApplicationName: string;
  temporaryWorkspace: {
    name: string;
    region: string;
    organizationId?: string;
    folderId?: string;
  };
  baselines: ReadonlyMap<string, MigrationTestBaseline>;
  baselineSnapshots: TailorDBMigrationTestSnapshots;
  targetSnapshots: TailorDBMigrationTestSnapshots;
  pendingNamespaces: string[];
  designatedTarget?: {
    id: string;
    region: string;
  };
}

interface MigrationTestWorkspace {
  id: string;
  name: string;
}

interface MigrationTestTarget {
  prepared: PreparedMigrationTest;
  targetWorkspaceId: string;
}

interface MigrationTestDataTarget extends MigrationTestTarget {
  sourceWorkspaceId: string;
  applicationName: string;
}

interface MigrationTestAssertionTarget extends MigrationTestTarget {
  assertionPath: string;
  assertionNamespace?: string;
  machineUser?: string;
}

export interface MigrationTestDependencies {
  prepare(options: MigrationTestOptions): Promise<PreparedMigrationTest>;
  createWorkspace(prepared: PreparedMigrationTest): Promise<MigrationTestWorkspace>;
  deployBaseline(target: MigrationTestTarget): Promise<void>;
  seedData(target: MigrationTestDataTarget): Promise<void>;
  cloneData(target: MigrationTestDataTarget): Promise<void>;
  deployMigrations(target: MigrationTestTarget): Promise<void>;
  runAssertion(target: MigrationTestAssertionTarget): Promise<void>;
  deleteWorkspace(workspaceId: string): Promise<void>;
}

export interface MigrationTestResult {
  success: true;
  workspaceId: string;
  workspaceName?: string;
  temporary: boolean;
  deleted: boolean;
  data: MigrationTestDataMode;
  pendingNamespaces: string[];
}
