const configPath = process.env.TAILOR_CONFIG_PATH;
const dtsPath = process.env["TAILOR_DTS_PATH"];
const baseUrl = process.env.PLATFORM_URL ?? "https://api.tailor.tech";
const logLevel = process.env.LOG_LEVEL ?? "DEBUG";
const token = process.env.TAILOR_PLATFORM_TOKEN;
const env = { LOG_LEVEL: "DEBUG", TAILOR_PLATFORM_TOKEN: token };
const command = "TAILOR_DEPLOY_BUILD_ONLY=true tailor-sdk deploy";
const LOG_LEVEL = "local";
const unchanged = process.env.MY_LOG_LEVEL ?? process.env.TAILOR_TOKEN_BACKUP;
