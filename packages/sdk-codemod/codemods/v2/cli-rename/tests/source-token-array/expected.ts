const args = ["tailor-sdk", "crashreport", "list", "--machine-user", "ci"];
const withRunner = ["npx", "tailor-sdk@latest", "crashreport", "--machine-user=ci"];
const packageRunnerValueArg = ["npx", "--cache", "tailor-sdk", "tailor-sdk", "crashreport", "--machine-user"];
const packageRunner = ["npx", "--package", "tailor-sdk", "tailor-sdk", "crashreport"];
const shortPackageRunner = ["npx", "-p", "tailor-sdk", "tailor-sdk", "crashreport"];
const nested = spawn("tailor-sdk", ["crashreport", "list", "--machine-user", "ci"]);
const forkedModule = child_process.fork("tailor-sdk/register", ["crash-report", "--machineuser"]);
const dynamic = ["tailor-sdk", "login", `--machine-user=${machineUser}`];
const conditional = ["tailor-sdk", "login", isCI ? "--machine-user" : "--json"];
const optional = ["tailor-sdk", "login", includeMachineUser && "--machine-user"];
const compactOptional = ["tailor-sdk", "login", includeMachineUser&&"--machine-user"];
const dynamicGlobalOption = ["tailor-sdk", verbose && "--verbose", "crashreport", "list"];
const dynamicInlineGlobalOption = ["tailor-sdk", useEnv ? "--env-file=.env" : "--json", "crashreport", "list"];
const profileGlobalOption = ["tailor-sdk", "--profile", "prod", "crashreport", "--machine-user"];
const workspaceGlobalOption = ["tailor-sdk", "-w", "workspace-1", "crashreport"];
const inlineEnvTemplate = ["tailor-sdk", `--env-file=${envFile}`, "crashreport", "list"];
const openEnvFileValue = ["tailor-sdk", "--env-file=", ".env", "crashreport", "--machine-user"];
const argValue = ["tailor-sdk", "function", "test-run", "--arg", "crash-report"];
const argCommandPayload = ["tailor-sdk", "function", "test-run", "--arg", "tailor-sdk crash-report --machineuser"];
const argCommandPayloadWithComment = [
  "tailor-sdk",
  "function",
  "test-run",
  "--arg",
  /* payload */ "tailor-sdk crash-report --machineuser",
];
const argCommandPayloadExpression = ["tailor-sdk", "function", "test-run", "--arg", cond ? "tailor-sdk crash-report --machineuser" : "{}"];
const argCommandPayloadTemplate = ["tailor-sdk", "function", "test-run", "--arg", `tailor-sdk crash-report --machineuser`];
const openArgValue = ["tailor-sdk", "function", "test-run", "--arg=", "--machineuser", "--machine-user"];
const shortArgValue = ["tailor-sdk", "function", "test-run", "-a", "--machineuser", "--machine-user"];
const queryValue = ["tailor-sdk", "query", "--query", "select --machineuser", "--machine-user", "ci"];
const queryValueWithComment = [
  "tailor-sdk",
  "query",
  "--query",
  /* sql */ "select --machineuser",
  "--machine-user",
];
const inlineQueryValue = ["tailor-sdk", "query", `--query=${payload ? "--machineuser" : ""}`, "--machine-user"];
const fileValue = ["tailor-sdk", "query", "--file", "queries/--machineuser.graphql", "--machine-user"];
const envFileValue = ["tailor-sdk", "--env-file", "crash-report", "crashreport"];
const envFileBackticks = [`tailor-sdk`, `--env-file`, `crash-report`, `crashreport`];
const envFileExpression = ["tailor-sdk", "--env-file", envFile, "crashreport", "list"];
const nestedProfile = spawn("tailor-sdk", ["--config", "tailor.config.ts", "crashreport"]);
const argExpression = ["tailor-sdk", "function", "test-run", "--arg", payload, "--machine-user"];
const dynamicArgExpression = ["tailor-sdk", "function", "test-run", includeArg ? "--arg" : "", "--machineuser"];
const inlineArgValue = ["tailor-sdk", "function", "test-run", "--arg=--machineuser"];
const inlineEnvFileValue = ["tailor-sdk", "--env-file=/tmp/--machineuser", "crashreport"];
const dynamicCommand = ["tailor-sdk", command, "crash-report", "--machine-user"];
const otherCli = ["other-cli", "crash-report", "--machineuser"];
const diagnostic = formatDiagnostic("tailor-sdk", "crash-report", "--machineuser");
const postCommandConditionalArg = ["tailor-sdk", "secret", "set", cond ? "crash-report" : "x", cond ? "--machine-user" : "--json"];
const postCommandLogicalArg = ["tailor-sdk", "secret", "set", cond && "crash-report", cond && "--machine-user"];
const dynamicLabel = `--machineuser=${machineUser}`;
const label = "crash-report";
const regexPattern = /tailor-sdk crash-report --machineuser/;
const prose = "package tailor-sdk crash-report --machineuser";
const proseTemplate = `package tailor-sdk crash-report --machineuser`;
const packageOptionData = ["tailor-sdk", "--machineuser"];
