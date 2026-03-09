import { parse } from "@0no-co/graphql.web";

/**
 * Return true when the buffered GraphQL input parses as a complete document.
 * @param input - Buffered GraphQL input
 * @returns True when the GraphQL document is complete and ready to execute
 */
export function isGraphQLInputComplete(input: string): boolean {
  if (input.trim().length === 0) {
    return false;
  }

  try {
    parse(input);
    return true;
  } catch {
    return false;
  }
}
