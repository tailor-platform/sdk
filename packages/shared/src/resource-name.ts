export const RESOURCE_NAME_PATTERN_SOURCE = "[a-z0-9][a-z0-9-]{1,61}[a-z0-9]";
export const RESOURCE_NAME_PATTERN = new RegExp(`^${RESOURCE_NAME_PATTERN_SOURCE}$`);
