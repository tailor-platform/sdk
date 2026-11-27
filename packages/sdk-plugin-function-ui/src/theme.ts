export function scopeTheme(css: string, scope: string): string {
  return css.replaceAll(".enlumine", `${scope} .enlumine`);
}
