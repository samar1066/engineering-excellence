/**
 * Layer contracts for this service, enforced as a build failure by EEP-ARCH-01.
 *
 * Two rules carry the layering, and two protect the check itself: an import nobody can resolve
 * would match no path rule and pass silently, and a cycle defeats layering without crossing any
 * single forbidden edge.
 */
module.exports = {
  forbidden: [
    {
      name: "domain-stays-pure",
      severity: "error",
      comment:
        "src/domain holds entities and contracts. It must not reach outward into HTTP handling " +
        "or storage: route the call through a workflow instead.",
      from: { path: "^src/domain" },
      to: { path: "^src/(routes|infrastructure)" },
    },
    {
      name: "routes-never-touch-infrastructure",
      severity: "error",
      comment:
        "src/routes speaks HTTP and calls one workflow method. A concrete repository reaches it " +
        "through src/app.ts, which injects it into the route plugin.",
      from: { path: "^src/routes" },
      to: { path: "^src/infrastructure" },
    },
    {
      name: "no-circular",
      severity: "error",
      comment: "A dependency cycle defeats layering without crossing a single forbidden edge.",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment:
        "An import nobody can resolve matches no path rule above, so it would pass every layer " +
        "contract by accident.",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    // swc parses TypeScript directly and counts `import type` as a dependency, so a layer cannot
    // be crossed by importing a type instead of a value. dependency-cruiser's other TypeScript
    // path drives the tsc compiler API, which it supports below version 7 only; swc keeps this
    // check honest without pinning the type checker to an older major.
    parser: "swc",
    doNotFollow: { path: "node_modules" },
    // Source files import each other by their emitted .js specifier, as NodeNext requires, so the
    // resolver is told to try .ts first when it follows one.
    enhancedResolveOptions: {
      extensions: [".ts", ".js", ".json"],
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
