import { randomUUID } from "node:crypto";
import { gql, GraphQLClient } from "graphql-request";
import { describe, expect, inject, test } from "vitest";

function createGraphQLClient(): GraphQLClient {
  const endpoint = new URL("/query", inject("url")).href;
  return new GraphQLClient(endpoint, {
    headers: {
      Authorization: `Bearer ${inject("token")}`,
    },
    // Prevent throwing errors on GraphQL errors.
    errorPolicy: "all",
  });
}

function getData<T>(result: { data: unknown }): T {
  return result.data as T;
}

describe("tailordb", () => {
  const graphQLClient = createGraphQLClient();

  describe.sequential("User CRUD", () => {
    const uuid = randomUUID();
    let userId: string;

    test("create a user", async () => {
      const query = gql`
        mutation ($input: UserCreateInput!) {
          createUser(input: $input) {
            id
            name
            email
            role
            createdAt
            updatedAt
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query, {
        input: { name: `test-user-${uuid}`, email: `user-${uuid}@example.com`, role: "MEMBER" },
      });
      expect(result.errors).toBeUndefined();
      const data = getData<{
        createUser: {
          id: string;
          name: string;
          email: string;
          role: string;
          createdAt: string;
          updatedAt: string;
        };
      }>(result);
      userId = data.createUser.id;
      expect(data.createUser.name).toBe(`test-user-${uuid}`);
      expect(data.createUser.email).toBe(`user-${uuid}@example.com`);
      expect(data.createUser.role).toBe("MEMBER");
      expect(data.createUser.createdAt).toBeDefined();
      expect(data.createUser.updatedAt).toBeDefined();
    });

    test("query the created user", async () => {
      const query = gql`
        query ($id: ID!) {
          user(id: $id) {
            id
            name
            email
            role
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query, { id: userId });
      expect(result.errors).toBeUndefined();
      const data = getData<{ user: { id: string; name: string; email: string; role: string } }>(
        result,
      );
      expect(data.user).toMatchObject({
        id: userId,
        name: `test-user-${uuid}`,
        email: `user-${uuid}@example.com`,
        role: "MEMBER",
      });
    });

    test("update the user", async () => {
      const query = gql`
        mutation ($id: ID!, $input: UserUpdateInput!) {
          updateUser(id: $id, input: $input) {
            id
            name
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query, {
        id: userId,
        input: { name: `updated-${uuid}` },
      });
      expect(result.errors).toBeUndefined();
      const data = getData<{ updateUser: { id: string; name: string } }>(result);
      expect(data.updateUser.name).toBe(`updated-${uuid}`);
    });

    test("delete the user", async () => {
      const query = gql`
        mutation ($id: ID!) {
          deleteUser(id: $id) {
            id
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query, { id: userId });
      expect(result.errors).toBeUndefined();
    });
  });

  test("unique constraint rejects duplicate email", async () => {
    const uuid = randomUUID();
    const email = `unique-${uuid}@example.com`;
    const query = gql`
      mutation ($input: UserCreateInput!) {
        createUser(input: $input) {
          id
        }
      }
    `;

    const first = await graphQLClient.rawRequest(query, {
      input: { name: "first", email, role: "MEMBER" },
    });
    expect(first.errors).toBeUndefined();

    const second = await graphQLClient.rawRequest(query, {
      input: { name: "second", email, role: "MEMBER" },
    });
    expect(second.errors).toBeDefined();
  });

  describe.sequential("Category with self-relation", () => {
    let parentId: string;
    let childId: string;

    test("create parent and child categories", async () => {
      const uuid = randomUUID();
      const createQuery = gql`
        mutation ($input: CategoryCreateInput!) {
          createCategory(input: $input) {
            id
            name
          }
        }
      `;

      const parentResult = await graphQLClient.rawRequest(createQuery, {
        input: { name: `parent-${uuid}` },
      });
      expect(parentResult.errors).toBeUndefined();
      parentId = getData<{ createCategory: { id: string } }>(parentResult).createCategory.id;

      const childResult = await graphQLClient.rawRequest(createQuery, {
        input: { name: `child-${uuid}`, parentCategoryId: parentId },
      });
      expect(childResult.errors).toBeUndefined();
      childId = getData<{ createCategory: { id: string } }>(childResult).createCategory.id;
    });

    test("query child with parent relation", async () => {
      const query = gql`
        query ($id: ID!) {
          category(id: $id) {
            id
            name
            parentCategory {
              id
              name
            }
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query, { id: childId });
      expect(result.errors).toBeUndefined();
      const data = getData<{ category: { parentCategory: { id: string } } }>(result);
      expect(data.category.parentCategory.id).toBe(parentId);
    });
  });

  describe.sequential("Task with relations and hooks", () => {
    let userId: string;
    let categoryId: string;

    test("create user and category for task", async () => {
      const uuid = randomUUID();

      const userQuery = gql`
        mutation ($input: UserCreateInput!) {
          createUser(input: $input) {
            id
          }
        }
      `;
      const userResult = await graphQLClient.rawRequest(userQuery, {
        input: { name: `assignee-${uuid}`, email: `assignee-${uuid}@example.com`, role: "ADMIN" },
      });
      expect(userResult.errors).toBeUndefined();
      userId = getData<{ createUser: { id: string } }>(userResult).createUser.id;

      const categoryQuery = gql`
        mutation ($input: CategoryCreateInput!) {
          createCategory(input: $input) {
            id
          }
        }
      `;
      const categoryResult = await graphQLClient.rawRequest(categoryQuery, {
        input: { name: `category-${uuid}` },
      });
      expect(categoryResult.errors).toBeUndefined();
      categoryId = getData<{ createCategory: { id: string } }>(categoryResult).createCategory.id;
    });

    test("create task with isArchived hook defaulting to false", async () => {
      const query = gql`
        mutation ($input: TaskCreateInput!) {
          createTask(input: $input) {
            id
            title
            status
            priority
            isArchived
            assignee {
              id
            }
            category {
              id
            }
            createdAt
            updatedAt
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query, {
        input: {
          title: "Test task",
          status: "TODO",
          priority: 2,
          assigneeId: userId,
          categoryId,
        },
      });
      expect(result.errors).toBeUndefined();
      const data = getData<{
        createTask: {
          isArchived: boolean;
          assignee: { id: string };
          category: { id: string };
          createdAt: string;
          updatedAt: string;
        };
      }>(result);
      expect(data.createTask.isArchived).toBe(false);
      expect(data.createTask.assignee.id).toBe(userId);
      expect(data.createTask.category.id).toBe(categoryId);
      expect(data.createTask.createdAt).toBeDefined();
      expect(data.createTask.updatedAt).toBeDefined();
    });
  });

  describe.sequential("Comment with nested object field", () => {
    let taskId: string;
    let userId: string;

    test("create user and task for comment", async () => {
      const uuid = randomUUID();

      const userQuery = gql`
        mutation ($input: UserCreateInput!) {
          createUser(input: $input) {
            id
          }
        }
      `;
      const userResult = await graphQLClient.rawRequest(userQuery, {
        input: {
          name: `commenter-${uuid}`,
          email: `commenter-${uuid}@example.com`,
          role: "ADMIN",
        },
      });
      expect(userResult.errors).toBeUndefined();
      userId = getData<{ createUser: { id: string } }>(userResult).createUser.id;

      const taskQuery = gql`
        mutation ($input: TaskCreateInput!) {
          createTask(input: $input) {
            id
          }
        }
      `;
      const taskResult = await graphQLClient.rawRequest(taskQuery, {
        input: { title: "Task for comment", status: "TODO", priority: 1 },
      });
      expect(taskResult.errors).toBeUndefined();
      taskId = getData<{ createTask: { id: string } }>(taskResult).createTask.id;
    });

    test("create comment with metadata object", async () => {
      const query = gql`
        mutation ($input: CommentCreateInput!) {
          createComment(input: $input) {
            id
            body
            task {
              id
            }
            author {
              id
            }
            metadata {
              source
              isInternal
            }
          }
        }
      `;
      const result = await graphQLClient.rawRequest(query, {
        input: {
          body: "This is a test comment",
          taskId,
          authorId: userId,
          metadata: {
            source: "e2e-test",
            isInternal: false,
          },
        },
      });
      expect(result.errors).toBeUndefined();
      const data = getData<{
        createComment: {
          body: string;
          task: { id: string };
          author: { id: string };
          metadata: { source: string; isInternal: boolean };
        };
      }>(result);
      expect(data.createComment.body).toBe("This is a test comment");
      expect(data.createComment.task.id).toBe(taskId);
      expect(data.createComment.author.id).toBe(userId);
      expect(data.createComment.metadata.source).toBe("e2e-test");
      expect(data.createComment.metadata.isInternal).toBe(false);
    });
  });
});
