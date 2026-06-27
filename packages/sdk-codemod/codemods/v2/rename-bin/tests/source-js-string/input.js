const script = "tailor-sdk deploy";
const proseApply = "Run tailor-sdk deploy to apply changes";
const spawned = spawn("tailor-sdk", ["deploy"]);
const runtimeArg = getArg();
const scopedRuntimeArgSpawned = spawn("tailor-sdk", [runtimeArg]);
const hiddenApplyArgs = ["apply"];
const hiddenApplySpawned = spawn("tailor-sdk", hiddenApplyArgs);
const argSpawned = spawn("tailor-sdk", ["--arg", "tailor-sdk deploy", "deploy"]);
const tailorBin = "tailor";
const aliasArgSpawned = spawn(tailorBin, ["--arg", "tailor-sdk deploy", "deploy"]);
const inlineArgSpawned = spawn("tailor-sdk", ["--arg=tailor-sdk deploy", "deploy"]);
const templateArgSpawned = spawn("tailor-sdk", ["--arg", `tailor-sdk ${cmd}`, "deploy"]);
const inlineTemplateArgSpawned = spawn("tailor-sdk", [`--arg=tailor-sdk ${cmd}`, "deploy"]);
const nameValueSpawned = spawn("tailor", ["tailordb", "migration", "generate", "--name", "tailor-sdk deploy"]);
const directNameValueSpawned = spawn("tailor-sdk", ["tailordb", "migration", "generate", "--name", "tailor-sdk deploy"]);
const shellSpawned = spawn("sh", ["-c", "tailor-sdk deploy"]);
const legacyApplyArg = "apply";
const legacyMachineUserArg = "--machineuser";
const legacyTemplateArg = "apply";
const templateBin = "tailor";
const templatedAliasArg = `${templateBin} --arg "tailor-sdk deploy" deploy`;
const applySpawned = spawn("tailor-sdk", ["apply"]);
const applyAliasSpawned = spawn("tailor-sdk", [legacyApplyArg]);
function unrelatedRuntimeArgScope() {
  const runtimeArg = "apply";
  return runtimeArg;
}
function duplicateAliasOne() {
  const duplicateLegacyArg = "apply";
  return spawn("tailor-sdk", [duplicateLegacyArg]);
}
function duplicateAliasTwo() {
  const duplicateLegacyArg = "apply";
  return spawn("tailor-sdk", [duplicateLegacyArg]);
}
function conflictingAliasLegacy() {
  const scopedArg = "apply";
  return spawn("tailor-sdk", [scopedArg]);
}
function conflictingAliasDeploy() {
  const scopedArg = "deploy";
  return spawn("tailor-sdk", [scopedArg]);
}
const cliRenameCommandSpawned = spawn("tailor-sdk", ["crash-report", "list"]);
const cliRenameFlagSpawned = spawn("tailor-sdk", ["login", "--machineuser"]);
const cliRenameFlagAliasSpawned = spawn("tailor-sdk", ["login", legacyMachineUserArg]);
const secretValueApplySpawned = spawn("tailor-sdk", ["secret", "create", "--value", "apply"]);
const secretShortValueApplySpawned = spawn("tailor-sdk", ["secret", "create", "-v", "apply"]);
const dynamicCliRenameCommandSpawned = spawn("tailor-sdk", [`${"apply"}`]);
const dynamicCliRenameAliasCommand = `tailor-sdk ${legacyTemplateArg}`;
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
const npxToolValueSpawned = spawn("npx", ["-p", "some-tool", "tool", "--name", "tailor-sdk", "deploy"]);
const npxPackageFlagSpawned = spawn("npx", ["-p", "tailor-sdk", "tailor-sdk", "login"]);
const npxPackageFlagWithRunnerOptionSpawned = spawn("npx", ["--package", "tailor-sdk", "--yes", "tailor-sdk", "login"]);
const npxMigratedPackageFlagWithRunnerOptionSpawned = spawn("npx", ["--package", "@tailor-platform/sdk", "--yes", "tailor-sdk", "login"]);
const npxMultiPackageFlagSpawned = spawn("npx", ["-p", "tailor-sdk", "-p", "dotenv-cli", "tailor-sdk", "login"]);
const npxMultiPackageFlagSecondSpawned = spawn("npx", ["-p", "dotenv-cli", "-p", "tailor-sdk", "tailor-sdk", "login"]);
const npxPackageEqualsSpawned = spawn("npx", ["--package=tailor-sdk", "tailor-sdk", "login"]);
const npxPackageFlagDynamicSpawned = spawn("npx", ["-p", "tailor-sdk", "tailor-sdk", subcommand]);
const npxPackageEqualsDynamicSpawned = spawn("npx", ["--package=tailor-sdk", "tailor-sdk", subcommand]);
const npxPackageMigratedSpawned = spawn("npx", ["--package", "@tailor-platform/sdk", "tailor-sdk", "login"]);
const npxPackageDynamicSpawned = spawn("npx", ["-p", pkg, "tailor-sdk", "login"]);
const npxOtherPackageCommandSpawned = spawn("npx", ["-p", "dotenv-cli", "tailor-sdk", "login"]);
const pnpmDlxSpawned = spawn("pnpm", ["dlx", "tailor-sdk", "login"]);
const pnpmDlxDynamicSpawned = spawn("pnpm", ["dlx", "tailor-sdk"]);
const pnpmDlxOtherPackageSpawned = spawn("pnpm", ["dlx", "foo", "tailor-sdk", "login"]);
const pnpmDlxOtherPackageFlagSpawned = spawn("pnpm", ["dlx", "foo", "-p", "tailor-sdk", "tailor-sdk", "login"]);
const pnpmDlxOptionSpawned = spawn("pnpm", ["--silent", "dlx", "tailor-sdk", "login"]);
const pnpmDlxSplitOptionSpawned = spawn("pnpm", ["--filter", "app", "dlx", "tailor-sdk", "login"]);
const pnpmDlxWorkspaceRootSpawned = spawn("pnpm", ["-w", "dlx", "tailor-sdk", "login"]);
const pnpmDlxRegistrySpawned = spawn("pnpm", ["--registry", registry, "dlx", "tailor-sdk", "login"]);
const pnpmExecSplitOptionSpawned = spawn("pnpm", ["--filter", "app", "exec", "tailor-sdk", "deploy"]);
const yarnDlxOptionSpawned = spawn("yarn", ["--quiet", "dlx", "tailor-sdk", "login"]);
const pnpmBinarySpawned = spawn("pnpm", ["tailor-sdk", "deploy"]);
const pnpmExecSpawned = spawn("pnpm", ["exec", "tailor-sdk", "deploy"]);
const pnpmExecDynamicSpawned = spawn("pnpm", ["exec", "tailor-sdk", subcommand]);
const pnpmExecHelpSpawned = spawn("pnpm", ["exec", "tailor-sdk", "--help"]);
const npmExecSpawned = spawn("npm", ["exec", "tailor-sdk", "login"]);
const npmExecWorkspaceSpawned = spawn("npm", ["-w", "app", "exec", "tailor-sdk", "login"]);
const npmExecLongWorkspaceSpawned = spawn("npm", [
  "--workspace",
  "app",
  "exec",
  "tailor-sdk",
  "login",
]);
const npmExecPackageFlagSpawned = spawn("npm", ["exec", "--package", "tailor-sdk", "tailor-sdk", "login"]);
const npmExecPackageEqualsSpawned = spawn("npm", ["exec", "--package=tailor-sdk", "tailor-sdk", "login"]);
const pathQualifiedSpawned = spawn("./node_modules/.bin/tailor-sdk", ["deploy"]);
const pathQualifiedArgSpawned = spawn("./node_modules/.bin/tailor-sdk", ["--arg", "tailor-sdk deploy", "deploy"]);
const packageDirectoryPathSpawned = spawn("./node_modules/tailor-sdk/bin/cli.js", ["deploy"]);
const windowsShimArgSpawned = spawn("tailor-sdk.cmd", ["--arg", "tailor-sdk deploy", "deploy"]);
const pathQualifiedWindowsShimArgSpawned = spawn("./node_modules/.bin/tailor-sdk.cmd", ["--arg", "tailor-sdk deploy", "deploy"]);
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
