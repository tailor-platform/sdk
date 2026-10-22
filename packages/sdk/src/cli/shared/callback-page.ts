type CallbackPageOptions = {
  title: string;
  message: string;
  closeWindow?: boolean;
};

const htmlEscapes = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
} as const;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => htmlEscapes[char as keyof typeof htmlEscapes]);
}

/**
 * Render the HTML page shown in the browser after a local OAuth2 callback.
 * @param options - Page content. `title` and `message` are HTML-escaped.
 * @returns HTML document
 */
export function renderCallbackPage(options: CallbackPageOptions) {
  const title = escapeHtml(options.title);
  const message = escapeHtml(options.message);
  const script = options.closeWindow ? "<script>window.close()</script>" : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${message}</p>${script}</body></html>`;
}
