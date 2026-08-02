# Pull request

<!-- What changed and why, in a sentence or two. Link the issue if there is one. -->

## Checklist

1. [ ] Both validators pass locally, run from `tools/eep`:
   `npx tsx src/index.ts corpus validate` and
   `npx tsx src/index.ts pack validate <dir>`.
2. [ ] Tests accompany behavior changes, and `npx vitest run` is green.
3. [ ] A new pack is one new directory and touches no existing file.
4. [ ] The style laws hold: no dash punctuation, ordered lists start at 1,
   hyphens only inside identifiers. CI will check.
5. [ ] Attribution frontmatter is present on every new governed document, and
   the author is named in `authors`.
