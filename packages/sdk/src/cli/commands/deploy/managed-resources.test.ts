import { describe, expect, test } from "vitest";
import { MANAGED_RESOURCES } from "./managed-resources";
import { emptyPlanResults, plannedDeleteLists } from "./test-helpers/plan-results";
import type { ManagedResourceType } from "./managed-resource-type";

describe("MANAGED_RESOURCES", () => {
  test("gives every planned delete list exactly one resource type", () => {
    const results = emptyPlanResults();
    const typesByList = new Map<unknown[], ManagedResourceType[]>();
    for (const [resourceType, resource] of Object.entries(MANAGED_RESOURCES)) {
      const { deletes } = resource.changeSetOf(results);
      typesByList.set(deletes, [
        ...(typesByList.get(deletes) ?? []),
        resourceType as ManagedResourceType,
      ]);
    }

    const typesByPath = [...plannedDeleteLists(results)].map(([path, list]) => [
      path,
      typesByList.get(list)?.length ?? 0,
    ]);

    expect(typesByPath.filter(([, count]) => count !== 1)).toEqual([]);
    expect(typesByList.size).toBe(Object.keys(MANAGED_RESOURCES).length);
  });
});
