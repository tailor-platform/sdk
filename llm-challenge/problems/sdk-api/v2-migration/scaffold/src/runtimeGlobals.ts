export type CustomerQueryResult = Tailordb.QueryResult<{ id: string; email: string }>;

export async function pingRuntime(email: string): Promise<string> {
  const encoded = tailor.iconv.convert(new TextEncoder().encode(email), "UTF-8", "UTF-8");
  const client = new tailordb.Client({ namespace: "tailordb" });
  await client.connect();
  await client.end();
  return `${encoded.byteLength}:${client.constructor.name}`;
}
