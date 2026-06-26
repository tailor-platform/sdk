const args = ["tailor-sdk", "crash-report", "list", "--machineuser", "ci"];
const withRunner = ["npx", "tailor-sdk@latest", "crash-report", "--machineuser=ci"];
const packageRunnerValueArg = ["npx", "--cache", "tailor-sdk", "tailor-sdk", "crash-report", "--machineuser"];
const packageRunner = ["npx", "--package", "tailor-sdk", "tailor-sdk", "crash-report"];
const shortPackageRunner = ["npx", "-p", "tailor-sdk", "tailor-sdk", "crash-report"];
const nested = spawn("tailor-sdk", ["crash-report", "list", "--machineuser", "ci"]);
const forkedModule = child_process.fork("tailor-sdk/register", ["crash-report", "--machineuser"]);
const dynamic = ["tailor-sdk", "login", `--machineuser=${machineUser}`];
const conditional = ["tailor-sdk", "login", isCI ? "--machineuser" : "--json"];
const optional = ["tailor-sdk", "login", includeMachineUser && "--machineuser"];
const compactOptional = ["tailor-sdk", "login", includeMachineUser&&"--machineuser"];
const dynamicGlobalOption = ["tailor-sdk", verbose && "--verbose", "crash-report", "list"];
const dynamicInlineGlobalOption = ["tailor-sdk", useEnv ? "--env-file=.env" : "--json", "crash-report", "list"];
const profileGlobalOption = ["tailor-sdk", "--profile", "prod", "crash-report", "--machineuser"];
const workspaceGlobalOption = ["tailor-sdk", "-w", "workspace-1", "crash-report"];
const inlineEnvTemplate = ["tailor-sdk", `--env-file=${envFile}`, "crash-report", "list"];
const openEnvFileValue = ["tailor-sdk", "--env-file=", ".env", "crash-report", "--machineuser"];
const argValue = ["tailor-sdk", "function", "test-run", "--arg", "crash-report"];
const openArgValue = ["tailor-sdk", "function", "test-run", "--arg=", "--machineuser", "--machineuser"];
const shortArgValue = ["tailor-sdk", "function", "test-run", "-a", "--machineuser", "--machineuser"];
const queryValue = ["tailor-sdk", "query", "--query", "select --machineuser", "--machineuser", "ci"];
const queryValueWithComment = [
  "tailor-sdk",
  "query",
  "--query",
  /* sql */ "select --machineuser",
  "--machineuser",
];
const inlineQueryValue = ["tailor-sdk", "query", `--query=${payload ? "--machineuser" : ""}`, "--machineuser"];
const fileValue = ["tailor-sdk", "query", "--file", "queries/--machineuser.graphql", "--machineuser"];
const envFileValue = ["tailor-sdk", "--env-file", "crash-report", "crash-report"];
const envFileBackticks = [`tailor-sdk`, `--env-file`, `crash-report`, `crash-report`];
const envFileExpression = ["tailor-sdk", "--env-file", envFile, "crash-report", "list"];
const nestedProfile = spawn("tailor-sdk", ["--config", "tailor.config.ts", "crash-report"]);
const argExpression = ["tailor-sdk", "function", "test-run", "--arg", payload, "--machineuser"];
const dynamicArgExpression = ["tailor-sdk", "function", "test-run", includeArg ? "--arg" : "", "--machineuser"];
const inlineArgValue = ["tailor-sdk", "function", "test-run", "--arg=--machineuser"];
const inlineEnvFileValue = ["tailor-sdk", "--env-file=/tmp/--machineuser", "crash-report"];
const dynamicCommand = ["tailor-sdk", command, "crash-report", "--machineuser"];
const otherCli = ["other-cli", "crash-report", "--machineuser"];
const diagnostic = formatDiagnostic("tailor-sdk", "crash-report", "--machineuser");
const postCommandConditionalArg = ["tailor-sdk", "secret", "set", cond ? "crash-report" : "x", cond ? "--machineuser" : "--json"];
const postCommandLogicalArg = ["tailor-sdk", "secret", "set", cond && "crash-report", cond && "--machineuser"];
const dynamicLabel = `--machineuser=${machineUser}`;
const label = "crash-report";
const regexPattern = /tailor-sdk crash-report --machineuser/;
const prose = "package tailor-sdk crash-report --machineuser";
const proseTemplate = `package tailor-sdk crash-report --machineuser`;
