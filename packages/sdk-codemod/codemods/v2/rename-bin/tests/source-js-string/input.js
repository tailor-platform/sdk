const script = "tailor-sdk deploy";
const spawned = spawn("tailor-sdk", ["deploy"]);
const argSpawned = spawn("tailor-sdk", ["--arg", "tailor-sdk deploy", "deploy"]);
const inlineArgSpawned = spawn("tailor-sdk", ["--arg=tailor-sdk deploy", "deploy"]);
const templateArgSpawned = spawn("tailor-sdk", ["--arg", `tailor-sdk ${cmd}`, "deploy"]);
const inlineTemplateArgSpawned = spawn("tailor-sdk", [`--arg=tailor-sdk ${cmd}`, "deploy"]);
const nameValueSpawned = spawn("tailor", ["tailordb", "migration", "generate", "--name", "tailor-sdk deploy"]);
const directNameValueSpawned = spawn("tailor-sdk", ["tailordb", "migration", "generate", "--name", "tailor-sdk deploy"]);
const shellSpawned = spawn("sh", ["-c", "tailor-sdk deploy"]);
const cliRenameCommandSpawned = spawn("tailor-sdk", ["crash-report", "list"]);
const cliRenameFlagSpawned = spawn("tailor-sdk", ["login", "--machineuser"]);
const npxSpawned = spawn("npx", ["tailor-sdk", "login"]);
const npxOptionSpawned = spawn("npx", ["--yes", "tailor-sdk@latest", "login"]);
const npxProfileSpawned = spawn("npx", ["tailor-sdk", "--profile", "dev", "login"]);
const npxShortProfileSpawned = spawn("npx", ["tailor-sdk", "-p", "dev", "login"]);
const npxProfileNamedTailorSdkSpawned = spawn("npx", ["tailor-sdk", "--profile", "tailor-sdk", "login"]);
const npxShortProfileNamedTailorSdkSpawned = spawn("npx", ["tailor-sdk", "-p", "tailor-sdk", "login"]);
const npxInlineProfileNamedTailorSdkSpawned = spawn("npx", ["tailor-sdk", "-p=tailor-sdk", "login"]);
const npxVersionSpawned = spawn("npx", ["tailor-sdk", "--version"]);
const npxDynamicSpawned = spawn("npx", ["tailor-sdk", subcommand]);
const npxOtherPackageSpawned = spawn("npx", ["foo", "tailor-sdk", "login"]);
const npxOtherPackageFlagSpawned = spawn("npx", ["foo", "-p", "tailor-sdk", "tailor-sdk", "login"]);
const npxOtherPackageEqualsSpawned = spawn("npx", ["foo", "--package=tailor-sdk", "tailor-sdk", "login"]);
const npxOtherPackageSplitSpawned = spawn("npx", ["foo", "--package", "tailor-sdk", "tailor-sdk", "login"]);
const npxPackageFlagSpawned = spawn("npx", ["-p", "tailor-sdk", "tailor-sdk", "login"]);
const npxMultiPackageFlagSpawned = spawn("npx", ["-p", "tailor-sdk", "-p", "dotenv-cli", "tailor-sdk", "login"]);
const npxMultiPackageFlagSecondSpawned = spawn("npx", ["-p", "dotenv-cli", "-p", "tailor-sdk", "tailor-sdk", "login"]);
const npxPackageEqualsSpawned = spawn("npx", ["--package=tailor-sdk", "tailor-sdk", "login"]);
const npxPackageFlagDynamicSpawned = spawn("npx", ["-p", "tailor-sdk", "tailor-sdk", subcommand]);
const npxPackageEqualsDynamicSpawned = spawn("npx", ["--package=tailor-sdk", "tailor-sdk", subcommand]);
const npxPackageMigratedSpawned = spawn("npx", ["--package", "@tailor-platform/sdk", "tailor-sdk", "login"]);
const npxPackageDynamicSpawned = spawn("npx", ["-p", pkg, "tailor-sdk", "login"]);
const pnpmDlxSpawned = spawn("pnpm", ["dlx", "tailor-sdk", "login"]);
const pnpmDlxDynamicSpawned = spawn("pnpm", ["dlx", "tailor-sdk"]);
const pnpmDlxOtherPackageSpawned = spawn("pnpm", ["dlx", "foo", "tailor-sdk", "login"]);
const pnpmDlxOtherPackageFlagSpawned = spawn("pnpm", ["dlx", "foo", "-p", "tailor-sdk", "tailor-sdk", "login"]);
const pnpmDlxOptionSpawned = spawn("pnpm", ["--silent", "dlx", "tailor-sdk", "login"]);
const pnpmDlxSplitOptionSpawned = spawn("pnpm", ["--filter", "app", "dlx", "tailor-sdk", "login"]);
const pnpmDlxRegistrySpawned = spawn("pnpm", ["--registry", registry, "dlx", "tailor-sdk", "login"]);
const pnpmExecSplitOptionSpawned = spawn("pnpm", ["--filter", "app", "exec", "tailor-sdk", "deploy"]);
const yarnDlxOptionSpawned = spawn("yarn", ["--quiet", "dlx", "tailor-sdk", "login"]);
const pnpmBinarySpawned = spawn("pnpm", ["tailor-sdk", "deploy"]);
const pnpmExecSpawned = spawn("pnpm", ["exec", "tailor-sdk", "deploy"]);
const pnpmExecDynamicSpawned = spawn("pnpm", ["exec", "tailor-sdk", subcommand]);
const pnpmExecHelpSpawned = spawn("pnpm", ["exec", "tailor-sdk", "--help"]);
const pathQualifiedSpawned = spawn("./node_modules/.bin/tailor-sdk", ["deploy"]);
const arrayCommand = ["tailor-sdk", "--profile", "dev", "deploy"];
const npxArgs = ["tailor-sdk", "login"];
spawn("npx", npxArgs);
const docs = (
  <>
    <p>package tailor-sdk is installed</p>
    <code>tailor-sdk deploy</code>
    <code>npx tailor-sdk@latest login</code>
  </>
);
