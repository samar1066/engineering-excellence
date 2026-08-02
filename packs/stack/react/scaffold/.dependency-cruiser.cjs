/**
 * Layer boundaries for this frontend, enforced as a build failure (EEP-ARCH-01).
 *
 * The direction is components to hooks to api, and never back. Type only imports count: the rule
 * is about which layer knows the wire format, and a type import is knowledge just the same, so
 * tsPreCompilationDeps stays on.
 */
module.exports = {
  forbidden: [
    {
      name: "components-never-import-api",
      comment:
        "Components read data through hooks. The hooks layer owns the API client and re-exports the wire types.",
      severity: "error",
      from: { path: "^src/components" },
      to: { path: "^src/api" },
    },
    {
      name: "hooks-never-import-components",
      comment: "State flows down into components; a hook that renders is a component.",
      severity: "error",
      from: { path: "^src/hooks" },
      to: { path: "^src/components" },
    },
    {
      name: "api-stays-a-leaf",
      comment: "The API client knows the wire and nothing about the screen above it.",
      severity: "error",
      from: { path: "^src/api" },
      to: { path: "^src/(components|hooks)" },
    },
    {
      name: "no-circular",
      comment: "A cycle makes every module in it impossible to reason about alone.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-dev-dep",
      comment: "Shipped code must not import a development only dependency.",
      severity: "error",
      from: { path: "^src", pathNot: "[.]test[.]tsx?$" },
      to: { dependencyTypes: ["npm-dev"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx"],
      mainFields: ["module", "main", "types"],
    },
  },
};
