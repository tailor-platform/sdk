import { describe, expect, test } from "vitest";
import { task } from "./task";
import { user } from "./user";
import { category } from "./category";
import { comment } from "./comment";

describe("TailorDB type definitions", () => {
  test("task type has expected fields", () => {
    const { fields } = task;
    expect(fields).toHaveProperty("title");
    expect(fields).toHaveProperty("status");
    expect(fields).toHaveProperty("priority");
    expect(fields).toHaveProperty("dueDate");
    expect(fields).toHaveProperty("assigneeId");
    expect(fields).toHaveProperty("categoryId");
    expect(fields).toHaveProperty("isArchived");
  });

  test("user type has expected fields", () => {
    const { fields } = user;
    expect(fields).toHaveProperty("name");
    expect(fields).toHaveProperty("email");
    expect(fields).toHaveProperty("role");
    expect(fields).toHaveProperty("bio");
  });

  test("category type has expected fields", () => {
    const { fields } = category;
    expect(fields).toHaveProperty("name");
    expect(fields).toHaveProperty("description");
    expect(fields).toHaveProperty("parentCategoryId");
  });

  test("comment type has expected fields", () => {
    const { fields } = comment;
    expect(fields).toHaveProperty("body");
    expect(fields).toHaveProperty("taskId");
    expect(fields).toHaveProperty("authorId");
    expect(fields).toHaveProperty("metadata");
  });
});
