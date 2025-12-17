export async function withTimeout(
  p: Promise<any>,
  ms: number,
  message: string,
) {
  return Promise.race([
    p,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms),
    ),
  ]);
}
