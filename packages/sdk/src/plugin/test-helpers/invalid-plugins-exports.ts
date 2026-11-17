export const invalidPluginsExports = [
  {
    name: "is not an array",
    pluginsExport: `{ id: "not-an-array", description: "Invalid" }`,
    message: "expected an array returned by definePlugins(), got object",
    issues: [{ path: [], message: "expected an array returned by definePlugins(), got object" }],
    suggestion: undefined,
  },
  {
    name: "is explicitly undefined",
    pluginsExport: "undefined",
    message: "expected an array returned by definePlugins(), got undefined",
    issues: [{ path: [], message: "expected an array returned by definePlugins(), got undefined" }],
    suggestion: undefined,
  },
  {
    name: "is null",
    pluginsExport: "null",
    message: "expected an array returned by definePlugins(), got null",
    issues: [{ path: [], message: "expected an array returned by definePlugins(), got null" }],
    suggestion: undefined,
  },
  {
    name: "contains a null item",
    pluginsExport: `[{ id: "valid", description: "Valid item" }, null]`,
    message: "Invalid `plugins` export",
    issues: [{ path: [1], message: "Invalid input: expected object, received null" }],
    suggestion: undefined,
  },
  {
    name: "contains an array decorated with plugin properties",
    pluginsExport: `[Object.assign([], { id: "array", description: "test" })]`,
    message: "Invalid `plugins` export",
    issues: [{ path: [0], message: "Invalid input: expected object, received array" }],
    suggestion: undefined,
  },
  {
    name: "contains an item missing required properties",
    pluginsExport: `[{ id: "valid", description: "test" }, { no: "shape" }]`,
    message: "Invalid `plugins` export",
    issues: [
      { path: [1, "id"], message: "Invalid input: expected string, received undefined" },
      { path: [1, "description"], message: "Invalid input: expected string, received undefined" },
    ],
    suggestion: undefined,
  },
  {
    name: "repeats a plugin ID",
    pluginsExport: `[{ id: "dup", description: "First" }, { id: "dup", description: "Second" }]`,
    message: 'Duplicate plugin ID "dup"',
    issues: [{ path: [1, "id"], message: 'Duplicate plugin ID "dup"' }],
    suggestion: "Give each plugin a unique ID.",
  },
  {
    name: "defines both TailorDB namespace hook names",
    pluginsExport: `[{ id: "both", description: "Defines both names", importPath: "@example/both",
      onTailorDBNamespaceLoaded: () => ({}), onNamespaceLoaded: () => ({}) }]`,
    message:
      "'onNamespaceLoaded' is the deprecated name of 'onTailorDBNamespaceLoaded'. Define only 'onTailorDBNamespaceLoaded'.",
    issues: [
      {
        path: [0, "onNamespaceLoaded"],
        message:
          "'onNamespaceLoaded' is the deprecated name of 'onTailorDBNamespaceLoaded'. Define only 'onTailorDBNamespaceLoaded'.",
      },
    ],
    suggestion: undefined,
  },
  {
    name: "has a string tableConfigRequired",
    pluginsExport: `[{ id: "invalid", description: "test", tableConfigRequired: "yes" }]`,
    message: "Invalid `plugins` export",
    issues: [{ path: [0, "tableConfigRequired"] }],
    suggestion: undefined,
  },
  {
    name: "has a null tableConfigRequired",
    pluginsExport: `[{ id: "invalid", description: "test", tableConfigRequired: null }]`,
    message: "Invalid `plugins` export",
    issues: [{ path: [0, "tableConfigRequired"] }],
    suggestion: undefined,
  },
  {
    name: "has a table hook with an empty importPath",
    pluginsExport: `[{ id: "invalid", description: "test", onTableLoaded() {}, importPath: "" }]`,
    message: "Invalid `plugins` export",
    issues: [{ path: [0] }],
    suggestion: undefined,
  },
  {
    name: "has a namespace hook without an importPath",
    pluginsExport: `[{ id: "invalid", description: "test", onTailorDBNamespaceLoaded() {} }]`,
    message: "Invalid `plugins` export",
    issues: [{ path: [0] }],
    suggestion: undefined,
  },
  {
    name: "has a non-function namespace hook",
    pluginsExport: `[{ id: "invalid", description: "test", onTailorDBNamespaceLoaded: 42, importPath: "@test/invalid" }]`,
    message: "Invalid `plugins` export",
    issues: [{ path: [0, "onTailorDBNamespaceLoaded"] }],
    suggestion: undefined,
  },
];
