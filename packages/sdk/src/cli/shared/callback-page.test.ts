import { describe, expect, test } from "vitest";
import { renderCallbackPage } from "./callback-page";

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
