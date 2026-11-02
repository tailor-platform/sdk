import { describe, expect, test } from "vitest";
import { commandPathFromArgv, lookupSkipReason } from "./decision";

describe("commandPathFromArgv", () => {
  test("returns the command and its subcommand", () => {
    expect(commandPathFromArgv(["deploy", "--dry-run"])).toEqual(["deploy"]);
    expect(commandPathFromArgv(["user", "pat", "list"])).toEqual(["user", "pat"]);
  });

  test("skips flags, including value-taking globals and --flag=value", () => {
    expect(commandPathFromArgv(["--profile", "x", "auth", "status"])).toEqual(["auth", "status"]);
    expect(commandPathFromArgv(["-p", "x", "-w", "ws", "workspace", "list"])).toEqual([
      "workspace",
      "list",
    ]);
    expect(commandPathFromArgv(["--profile=x", "--verbose", "deploy"])).toEqual(["deploy"]);
    expect(commandPathFromArgv(["-e", ".env", "login"])).toEqual(["login"]);
    expect(commandPathFromArgv(["--env-file-if-exists", ".env", "login"])).toEqual(["login"]);
    expect(commandPathFromArgv(["user", "--profile", "x", "pat"])).toEqual(["user", "pat"]);
  });

  test("stops at the -- separator", () => {
    expect(commandPathFromArgv(["--", "deploy"])).toEqual([]);
    expect(commandPathFromArgv(["user", "--", "pat"])).toEqual(["user"]);
  });

  test("is empty with no positional", () => {
    expect(commandPathFromArgv([])).toEqual([]);
    expect(commandPathFromArgv(["--json"])).toEqual([]);
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

  test("skips --help-all and its short form -H like the other help flags", () => {
    expect(lookupSkipReason(["workspace", "--help-all"], {})).toBe("help");
    expect(lookupSkipReason(["workspace", "-H"], {})).toBe("help");
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

  test("skips the local-only user commands but not user pat", () => {
    for (const argv of [
      ["user"],
      ["user", "list"],
      ["user", "current"],
      ["user", "switch", "someone@example.com"],
      ["user", "update", "--profile", "x"],
    ]) {
      expect(lookupSkipReason(argv, {})).toBe("excluded-command");
    }
    expect(lookupSkipReason(["user", "pat", "list"], {})).toBeUndefined();
    expect(lookupSkipReason(["user", "--profile", "x", "pat"], {})).toBeUndefined();
  });
});
