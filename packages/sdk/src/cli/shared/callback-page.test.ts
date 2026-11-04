import { describe, expect, test, vi } from "vitest";
import { renderCallbackPage, sendCallbackFailure, sendCallbackSuccess } from "./callback-page";
import { CLIError } from "./errors";

function fakeResponse() {
  const writeHead = vi.fn();
  const end = vi.fn();
  return { res: { writeHead, end } as never, writeHead, end };
}

describe("renderCallbackPage", () => {
  test("escapes HTML in the title and message", () => {
    const html = renderCallbackPage({
      status: "failure",
      title: "<i>t</i>",
      message: '<script>alert("x")</script>',
    });

    expect(html).toContain("&lt;i&gt;t&lt;/i&gt;");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  test("tries to close the tab on success without offering a close button", () => {
    const html = renderCallbackPage({ status: "success", title: "Done", message: "Back" });

    expect(html).toContain("window.close()");
    expect(html).not.toContain("<button");
  });

  test("runs no script on failure", () => {
    const html = renderCallbackPage({ status: "failure", title: "Oops", message: "Back" });

    expect(html).not.toContain("<script");
  });

  test("follows the system color scheme", () => {
    const html = renderCallbackPage({ status: "success", title: "Done", message: "Back" });

    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain('name="viewport"');
  });
});

describe("sendCallbackSuccess", () => {
  test("responds 200 with the success page as UTF-8 HTML", () => {
    const { res, writeHead, end } = fakeResponse();

    sendCallbackSuccess(res, "Done");

    expect(writeHead).toHaveBeenCalledWith(200, { "Content-Type": "text/html; charset=utf-8" });
    expect(end.mock.calls[0]?.[0]).toContain("<h1>Done</h1>");
    expect(end.mock.calls[0]?.[0]).toContain("close this tab");
  });
});

describe("sendCallbackFailure", () => {
  test("shows the message of a CLIError with the given status", () => {
    const { res, writeHead, end } = fakeResponse();

    sendCallbackFailure(res, 401, "Failed", CLIError({ code: "X", message: "profile mismatch" }));

    expect(writeHead).toHaveBeenCalledWith(401, { "Content-Type": "text/html; charset=utf-8" });
    expect(end.mock.calls[0]?.[0]).toContain("profile mismatch");
  });

  test("hides the message of any other error", () => {
    const { res, end } = fakeResponse();

    sendCallbackFailure(res, 400, "Failed", new Error("secret-internal-detail"));

    expect(end.mock.calls[0]?.[0]).toContain("Return to the terminal for details.");
    expect(end.mock.calls[0]?.[0]).not.toContain("secret-internal-detail");
  });
});
