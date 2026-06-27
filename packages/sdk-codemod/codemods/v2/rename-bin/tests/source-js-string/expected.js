const script = "tailor deploy";
const proseApply = "Run tailor deploy to apply changes";
const spawned = spawn("tailor", ["deploy"]);
const argSpawned = spawn("tailor", ["--arg", "tailor-sdk deploy", "deploy"]);
const inlineArgSpawned = spawn("tailor", ["--arg=tailor-sdk deploy", "deploy"]);
const templateArgSpawned = spawn("tailor", ["--arg", `tailor-sdk ${cmd}`, "deploy"]);
const inlineTemplateArgSpawned = spawn("tailor", [`--arg=tailor-sdk ${cmd}`, "deploy"]);
const nameValueSpawned = spawn("tailor", ["tailordb", "migration", "generate", "--name", "tailor-sdk deploy"]);
const directNameValueSpawned = spawn("tailor", ["tailordb", "migration", "generate", "--name", "tailor-sdk deploy"]);
const shellSpawned = spawn("sh", ["-c", "tailor deploy"]);
const applySpawned = spawn("tailor-sdk", ["apply"]);
const cliRenameCommandSpawned = spawn("tailor-sdk", ["crash-report", "list"]);
const cliRenameFlagSpawned = spawn("tailor-sdk", ["login", "--machineuser"]);
const dynamicCliRenameCommandSpawned = spawn("tailor-sdk", [`${"apply"}`]);
const npxSpawned = spawn("npx", ["@tailor-platform/sdk", "login"]);
const npxOptionSpawned = spawn("npx", ["--yes", "@tailor-platform/sdk@latest", "login"]);
const npxProfileSpawned = spawn("npx", ["@tailor-platform/sdk", "--profile", "dev", "login"]);
const npxShortProfileSpawned = spawn("npx", ["@tailor-platform/sdk", "-p", "dev", "login"]);
const npxProfileNamedTailorSdkSpawned = spawn("npx", ["@tailor-platform/sdk", "--profile", "tailor-sdk", "login"]);
const npxShortProfileNamedTailorSdkSpawned = spawn("npx", ["@tailor-platform/sdk", "-p", "tailor-sdk", "login"]);
const npxInlineProfileNamedTailorSdkSpawned = spawn("npx", ["@tailor-platform/sdk", "-p=tailor-sdk", "login"]);
const npxVersionSpawned = spawn("npx", ["@tailor-platform/sdk", "--version"]);
const npxDynamicSpawned = spawn("npx", ["@tailor-platform/sdk", subcommand]);
const npxOtherPackageSpawned = spawn("npx", ["foo", "tailor-sdk", "login"]);
const npxOtherPackageFlagSpawned = spawn("npx", ["foo", "-p", "tailor-sdk", "tailor-sdk", "login"]);
const npxOtherPackageEqualsSpawned = spawn("npx", ["foo", "--package=tailor-sdk", "tailor-sdk", "login"]);
const npxOtherPackageSplitSpawned = spawn("npx", ["foo", "--package", "tailor-sdk", "tailor-sdk", "login"]);
const npxToolValueSpawned = spawn("npx", ["-p", "some-tool", "tool", "--name", "tailor-sdk", "deploy"]);
const npxPackageFlagSpawned = spawn("npx", ["-p", "@tailor-platform/sdk", "tailor", "login"]);
const npxPackageFlagWithRunnerOptionSpawned = spawn("npx", ["--package", "@tailor-platform/sdk", "--yes", "tailor", "login"]);
const npxMigratedPackageFlagWithRunnerOptionSpawned = spawn("npx", ["--package", "@tailor-platform/sdk", "--yes", "tailor", "login"]);
const npxMultiPackageFlagSpawned = spawn("npx", ["-p", "@tailor-platform/sdk", "-p", "dotenv-cli", "tailor", "login"]);
const npxMultiPackageFlagSecondSpawned = spawn("npx", ["-p", "dotenv-cli", "-p", "@tailor-platform/sdk", "tailor", "login"]);
const npxPackageEqualsSpawned = spawn("npx", ["--package=@tailor-platform/sdk", "tailor", "login"]);
const npxPackageFlagDynamicSpawned = spawn("npx", ["-p", "@tailor-platform/sdk", "tailor", subcommand]);
const npxPackageEqualsDynamicSpawned = spawn("npx", ["--package=@tailor-platform/sdk", "tailor", subcommand]);
const npxPackageMigratedSpawned = spawn("npx", ["--package", "@tailor-platform/sdk", "tailor", "login"]);
const npxPackageDynamicSpawned = spawn("npx", ["-p", pkg, "tailor-sdk", "login"]);
const npxOtherPackageCommandSpawned = spawn("npx", ["-p", "dotenv-cli", "tailor-sdk", "login"]);
const pnpmDlxSpawned = spawn("pnpm", ["dlx", "@tailor-platform/sdk", "login"]);
const pnpmDlxDynamicSpawned = spawn("pnpm", ["dlx", "@tailor-platform/sdk"]);
const pnpmDlxOtherPackageSpawned = spawn("pnpm", ["dlx", "foo", "tailor-sdk", "login"]);
const pnpmDlxOtherPackageFlagSpawned = spawn("pnpm", ["dlx", "foo", "-p", "tailor-sdk", "tailor-sdk", "login"]);
const pnpmDlxOptionSpawned = spawn("pnpm", ["--silent", "dlx", "@tailor-platform/sdk", "login"]);
const pnpmDlxSplitOptionSpawned = spawn("pnpm", ["--filter", "app", "dlx", "@tailor-platform/sdk", "login"]);
const pnpmDlxRegistrySpawned = spawn("pnpm", ["--registry", registry, "dlx", "@tailor-platform/sdk", "login"]);
const pnpmExecSplitOptionSpawned = spawn("pnpm", ["--filter", "app", "exec", "tailor", "deploy"]);
const yarnDlxOptionSpawned = spawn("yarn", ["--quiet", "dlx", "@tailor-platform/sdk", "login"]);
const pnpmBinarySpawned = spawn("pnpm", ["tailor-sdk", "deploy"]);
const pnpmExecSpawned = spawn("pnpm", ["exec", "tailor", "deploy"]);
const pnpmExecDynamicSpawned = spawn("pnpm", ["exec", "tailor", subcommand]);
const pnpmExecHelpSpawned = spawn("pnpm", ["exec", "tailor", "--help"]);
const npmExecSpawned = spawn("npm", ["exec", "@tailor-platform/sdk", "login"]);
const npmExecPackageFlagSpawned = spawn("npm", ["exec", "--package", "@tailor-platform/sdk", "tailor", "login"]);
const npmExecPackageEqualsSpawned = spawn("npm", ["exec", "--package=@tailor-platform/sdk", "tailor", "login"]);
const pathQualifiedSpawned = spawn("./node_modules/.bin/tailor", ["deploy"]);
const pathQualifiedArgSpawned = spawn("./node_modules/.bin/tailor", ["--arg", "tailor-sdk deploy", "deploy"]);
const arrayCommand = ["tailor-sdk", "--profile", "dev", "deploy"];
const npxArgs = ["tailor-sdk", "login"];
spawn("npx", npxArgs);
const docs = (
  <>
    <p>package tailor-sdk is installed</p>
    <code>tailor deploy</code>
    <code>npx @tailor-platform/sdk@latest login</code>
  </>
);
