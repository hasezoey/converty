# Agent instructions

## Tech Stack

This project uses TypeScript. Avoid pure javascript, except for configs (like eslint.mjs).
We also make use of packages like `jsdom` for complete xhtml and style reading and modification.

## Recommended Commands

- `npm test`
- `npm run lint` / `npm run lint -- --fix`
- `npm run build:tests` to build & type-check all TypeScript files

## Tools

- Use native file tools (read, glob, grep) instead of chaining bash commands like cat or find when exploring.
- Run tests after multi-file changes.
- Finally, make sure everything still builds without errors or warnings.

## Additional notes

- Don't ever use copyrighted material directly from the books. Change it to be mock words / skeleton or use public domain text (like lorem ipsum) before using in tests.
- Tests that need to clean up like global variables (like `process.env`) or files / directories should happen outside of tests (jest equivalent of `afterEach`, or more specific to tests if available)
- When using code oneliners, pretty print them so that they can be easily reviewed.

## Styling

### Common

For exact styling see `.editorconfig`, `eslint.config.mjs` and `.prettierrc`, but the rough points are:
- use LF line endings
- use 2 SPACE indentation, where TAB is not required

When there are longer xml, json or similar data that needs to be embedded, prettify them instead of having one big line.

### Tests

Tests are split into individual files to not have a single one grow too big.
The naming directory and naming scheme is roughly `FOLDER/MODULENAME(.FUNCTION).test.ts`, where `FUNCTION` is optional if the module is small, otherwise for a specific function if that single function testing is large, or consider other names like `.helpers.`.

Tests make use of vitest.
Each test needs to be within a `describe` block, which is commonly the function name that is tested.
Each test's name should be descriptive about what it is testing.

Unit tests should:
- be concise and generally not use the "Arrange, Act, Assert" style, but should be considered for larger tests.
- be descriptive and minimal, generally not requiring comments, but more complex or "magic" should be commented.
- share setup if possible.
- should not do cleanup in the tests themselves, use `afterEach` / `afterAll` for cleanup.

Test fixtures live in `fixtures/`.

End-to-End tests should be separate from unit tests.
The `src/bin/main.ts` file does not need to be tested as it is just a call of `src/main.ts`.

## Change size

- We follow the "a commit should be minimal", at least in a reasonable amount.
  Example: don't split every single line change into a commit, but don't bloat it to the size of many different features. Pause and ask the user if unsure.
