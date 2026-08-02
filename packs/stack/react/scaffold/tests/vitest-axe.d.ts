import "vitest";

/**
 * vitest-axe declares its matcher against the global `Vi` namespace that vitest has since
 * retired, so the matcher it registers at runtime is typed here against the interface vitest
 * exposes today. The type parameter has to repeat vitest's own `Matchers<T = any>` exactly, or
 * this stops being a merge and becomes a redeclaration. Delete this file when vitest-axe ships an
 * augmentation of its own.
 */
declare module "vitest" {
  // biome-ignore lint/suspicious/noExplicitAny: must match vitest's own Matchers declaration.
  interface Matchers<T = any> {
    toHaveNoViolations(): T;
  }
}
