const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  '"': "&quot;",
  "<": "&lt;",
  ">": "&gt;",
};

export function injectToken(template: string, token: string): string {
  if (!template.includes("<head>")) throw new Error("The Function run page has no <head>.");
  const content = token.replace(/[&"<>]/g, (char) => ESCAPES[char] ?? char);
  return template.replace("<head>", `<head><meta name="tailor-studio-token" content="${content}">`);
}
