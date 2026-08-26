import { db } from "@tailor-platform/sdk";

export function buildField(db: { string(): { hooks(config: unknown): unknown } }) {
  return db.string().hooks({
    create: ({ user }: { user: { id: string } }) => user.id,
  });
}
