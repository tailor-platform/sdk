import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, test, vi } from "vitest";
import { createMockClient, createRemoteCheckpoint } from "./migration-apply";

const WORKSPACE_ID = "test-workspace";
const NAMESPACE = "test-ns";

const table = (name: string) => ({
  workspaceId: WORKSPACE_ID,
  namespaceName: NAMESPACE,
  tailordbType: { name },
});
const tableName = (name: string) => ({
  workspaceId: WORKSPACE_ID,
  namespaceName: NAMESPACE,
  tailordbTypeName: name,
});
const permission = (typeName: string) => ({
  workspaceId: WORKSPACE_ID,
  namespaceName: NAMESPACE,
  typeName,
});

describe("createMockClient", () => {
  test("rejects creating a table it already created, as the Platform does", async () => {
    const client = createMockClient();
    await client.createTailorDBType(table("User"));

    await expect(client.createTailorDBType(table("User"))).rejects.toMatchObject({
      code: Code.AlreadyExists,
    });
    await expect(createMockClient().createTailorDBType(table("User"))).resolves.toEqual({});
  });

  test("rejects updating or deleting a table it deleted", async () => {
    const client = createMockClient();
    await client.deleteTailorDBType(tableName("User"));

    await expect(client.updateTailorDBType(table("User"))).rejects.toMatchObject({
      code: Code.NotFound,
    });
    await expect(client.deleteTailorDBType(tableName("User"))).rejects.toMatchObject({
      code: Code.NotFound,
    });
  });

  test("rejects writing the GraphQL permission of a table it deleted", async () => {
    const client = createMockClient();
    await client.deleteTailorDBType(tableName("User"));

    const notFound = { code: Code.NotFound };
    await expect(client.createTailorDBGQLPermission(permission("User"))).rejects.toMatchObject(
      notFound,
    );
    await expect(client.updateTailorDBGQLPermission(permission("User"))).rejects.toMatchObject(
      notFound,
    );
    await expect(client.deleteTailorDBGQLPermission(permission("User"))).rejects.toMatchObject(
      notFound,
    );
  });

  test("accepts creating a table and its GraphQL permission again after deleting the table", async () => {
    const client = createMockClient();
    await client.createTailorDBType(table("User"));
    await client.createTailorDBGQLPermission(permission("User"));
    await client.deleteTailorDBType(tableName("User"));

    await expect(client.createTailorDBType(table("User"))).resolves.toEqual({});
    await expect(client.createTailorDBGQLPermission(permission("User"))).resolves.toEqual({});
  });

  test("rejects creating a GraphQL permission it already created", async () => {
    const client = createMockClient();
    await client.createTailorDBGQLPermission(permission("User"));

    await expect(client.createTailorDBGQLPermission(permission("User"))).rejects.toMatchObject({
      code: Code.AlreadyExists,
    });
  });

  test("rejects updating or deleting a GraphQL permission that a table it created lacks", async () => {
    const client = createMockClient();
    await client.createTailorDBType(table("User"));

    await expect(client.updateTailorDBGQLPermission(permission("User"))).rejects.toMatchObject({
      code: Code.NotFound,
    });
    await expect(client.deleteTailorDBGQLPermission(permission("User"))).rejects.toMatchObject({
      code: Code.NotFound,
    });
  });

  test("rejects deleting a GraphQL permission it already deleted", async () => {
    const client = createMockClient();
    await client.deleteTailorDBGQLPermission(permission("User"));

    await expect(client.deleteTailorDBGQLPermission(permission("User"))).rejects.toMatchObject({
      code: Code.NotFound,
    });
  });

  test("rejects creating a table or GraphQL permission that its listing returned", async () => {
    const client = createMockClient({
      listTailorDBTypes: { tailordbTypes: [{ name: "User" }] },
      listTailorDBGQLPermissions: { permissions: [{ typeName: "User" }] },
    });
    const namespace = { workspaceId: WORKSPACE_ID, namespaceName: NAMESPACE };
    await client.listTailorDBTypes(namespace);
    await client.listTailorDBGQLPermissions(namespace);

    const alreadyExists = { code: Code.AlreadyExists };
    await expect(client.createTailorDBType(table("User"))).rejects.toMatchObject(alreadyExists);
    await expect(client.createTailorDBGQLPermission(permission("User"))).rejects.toMatchObject(
      alreadyExists,
    );
    await expect(
      client.createTailorDBType({ ...table("User"), namespaceName: "other-ns" }),
    ).resolves.toEqual({});
  });

  test("rejects creating a table or GraphQL permission that a listing the test replaced returned, after a failed listing", async () => {
    const client = createMockClient({
      listTailorDBGQLPermissions: { permissions: [] },
    });
    const namespace = { workspaceId: WORKSPACE_ID, namespaceName: NAMESPACE };
    const unavailable = new ConnectError("unavailable", Code.Unavailable);
    vi.mocked(client.listTailorDBTypes).mockRejectedValueOnce(unavailable);
    vi.mocked(client.listTailorDBGQLPermissions).mockRejectedValueOnce(unavailable);
    await expect(client.listTailorDBTypes(namespace)).rejects.toThrow("unavailable");
    await expect(client.listTailorDBGQLPermissions(namespace)).rejects.toThrow("unavailable");
    vi.mocked(client.listTailorDBTypes).mockResolvedValue({ tailordbTypes: [{ name: "User" }] });
    vi.mocked(client.listTailorDBGQLPermissions).mockResolvedValue({
      permissions: [{ typeName: "User" }],
    });
    await client.listTailorDBTypes(namespace);
    await client.listTailorDBGQLPermissions(namespace);

    const alreadyExists = { code: Code.AlreadyExists };
    await expect(client.createTailorDBType(table("User"))).rejects.toMatchObject(alreadyExists);
    await expect(client.createTailorDBGQLPermission(permission("User"))).rejects.toMatchObject(
      alreadyExists,
    );
  });

  test("accepts creating a table or GraphQL permission it deleted although a later listing still returns it", async () => {
    const client = createMockClient({
      listTailorDBTypes: { tailordbTypes: [{ name: "User" }, { name: "Post" }] },
      listTailorDBGQLPermissions: { permissions: [{ typeName: "Post" }] },
    });
    const namespace = { workspaceId: WORKSPACE_ID, namespaceName: NAMESPACE };
    await client.deleteTailorDBType(tableName("User"));
    await client.deleteTailorDBGQLPermission(permission("Post"));
    await client.listTailorDBTypes(namespace);
    await client.listTailorDBGQLPermissions(namespace);

    await expect(client.createTailorDBType(table("User"))).resolves.toEqual({});
    await expect(client.createTailorDBGQLPermission(permission("Post"))).resolves.toEqual({});
  });

  test("rejects the second of two concurrent creates of a table", async () => {
    const client = createMockClient();

    const results = await Promise.allSettled([
      client.createTailorDBType(table("User")),
      client.createTailorDBType(table("User")),
    ]);

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
  });

  test("accepts creating a table or its GraphQL permission again after its create fails", async () => {
    const rejectFirst = () => {
      let rejected = false;
      return async () => {
        if (rejected) return {};
        rejected = true;
        throw new ConnectError("internal", Code.Internal);
      };
    };
    const client = createMockClient({
      createTailorDBType: rejectFirst(),
      createTailorDBGQLPermission: rejectFirst(),
    });
    const internal = { code: Code.Internal };

    await expect(client.createTailorDBType(table("User"))).rejects.toMatchObject(internal);
    await expect(client.createTailorDBType(table("User"))).resolves.toEqual({});
    await expect(client.createTailorDBGQLPermission(permission("User"))).rejects.toMatchObject(
      internal,
    );
    await expect(client.createTailorDBGQLPermission(permission("User"))).resolves.toEqual({});
  });

  test.each([
    { builder: "createMockClient", build: createMockClient },
    { builder: "the checkpoint client", build: createRemoteCheckpoint(0).createMockClient },
  ])("tracks the writes of the methods a test overrides on $builder", async ({ build }) => {
    const client = build({ createTailorDBType: async () => ({}) });
    await client.createTailorDBType(table("User"));

    await expect(client.createTailorDBType(table("User"))).rejects.toMatchObject({
      code: Code.AlreadyExists,
    });
  });
});
