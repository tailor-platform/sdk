import { describe, expect, test } from "vitest";
import { commandNameFromArgv, lookupSkipReason, profileFromArgv } from "./decision";

describe("commandNameFromArgv", () => {
  test("returns the first positional token", () => {
    expect(commandNameFromArgv(["deploy", "--dry-run"])).toBe("deploy");
  });

  test("skips leading flags, including value-taking globals and --flag=value", () => {
    expect(commandNameFromArgv(["--profile", "x", "auth", "status"])).toBe("auth");
    expect(commandNameFromArgv(["-p", "x", "-w", "ws", "workspace", "list"])).toBe("workspace");
    expect(commandNameFromArgv(["--profile=x", "--verbose", "deploy"])).toBe("deploy");
    expect(commandNameFromArgv(["-e", ".env", "login"])).toBe("login");
    expect(commandNameFromArgv(["--env-file-if-exists", ".env", "login"])).toBe("login");
  });

  test("stops at the -- separator", () => {
    expect(commandNameFromArgv(["--", "deploy"])).toBeUndefined();
  });

  test("is undefined with no positional", () => {
    expect(commandNameFromArgv([])).toBeUndefined();
    expect(commandNameFromArgv(["--json"])).toBeUndefined();
  });
});

describe("lookupSkipReason", () => {
  test("runs the lookup for an ordinary platform command", () => {
    expect(lookupSkipReason(["deploy"], {})).toBeUndefined();
    expect(lookupSkipReason(["workspace", "list", "--profile", "x"], {})).toBeUndefined();
  });

  test("honours TAILOR_NOTIFICATION_BANNER=off (and other false spellings)", () => {
    expect(lookupSkipReason(["deploy"], { TAILOR_NOTIFICATION_BANNER: "off" })).toBe("disabled");
    expect(lookupSkipReason(["deploy"], { TAILOR_NOTIFICATION_BANNER: "0" })).toBe("disabled");
    expect(lookupSkipReason(["deploy"], { TAILOR_NOTIFICATION_BANNER: "on" })).toBeUndefined();
    expect(lookupSkipReason(["deploy"], { TAILOR_NOTIFICATION_BANNER: "weird" })).toBeUndefined();
  });

  test("skips help, version and a bare invocation", () => {
    expect(lookupSkipReason(["deploy", "--help"], {})).toBe("help");
    expect(lookupSkipReason(["-h"], {})).toBe("help");
    expect(lookupSkipReason(["--help-json"], {})).toBe("help");
    expect(lookupSkipReason(["--version"], {})).toBe("help");
    expect(lookupSkipReason(["-v"], {})).toBe("help");
    expect(lookupSkipReason([], {})).toBe("no-command");
  });

  test("does not treat --help after the -- separator as help", () => {
    expect(lookupSkipReason(["deploy", "--", "--help"], {})).toBeUndefined();
  });

  test("skips the notification commands themselves and the excluded commands", () => {
    for (const argv of [
      ["notification", "list"],
      ["notification"],
      ["login"],
      ["logout"],
      ["--profile", "x", "auth", "status"],
      ["api", "ListWorkspaces"],
      ["query"],
      ["init"],
      ["generate"],
      ["show"],
      ["plugin", "list"],
      ["skills", "add"],
      ["completion", "zsh"],
      ["crashreport", "list"],
      ["upgrade"],
      ["profile", "list"],
      ["open"],
      ["__complete"],
    ]) {
      expect(lookupSkipReason(argv, {})).toBe("excluded-command");
    }
  });
});

describe("profileFromArgv", () => {
  test("reads the three spellings anywhere before --", () => {
    expect(profileFromArgv(["deploy", "--profile", "staging"])).toBe("staging");
    expect(profileFromArgv(["--profile=prod", "deploy"])).toBe("prod");
    expect(profileFromArgv(["workspace", "list", "-p", "dev"])).toBe("dev");
  });

  test("is undefined without a usable value", () => {
    expect(profileFromArgv(["deploy"])).toBeUndefined();
    expect(profileFromArgv(["deploy", "--profile"])).toBeUndefined();
    expect(profileFromArgv(["deploy", "--profile", "--json"])).toBeUndefined();
    expect(profileFromArgv(["deploy", "--", "--profile", "x"])).toBeUndefined();
  });
});
