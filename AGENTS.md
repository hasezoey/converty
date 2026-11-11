# Agent instructions

## Tech Stack

This project uses TypeScript and Node.js (>=22). Avoid plain JavaScript except for configuration files. The converter uses `jsdom` to read
and modify XHTML and styles.

## Architecture

- `src/bin/main.ts` is the executable entry point and delegates to `src/main.ts`, which discovers and runs compiled modules.
- `src/utils.ts` defines the `ConverterModule` and `ConverterOptions` contracts. Modules in `src/modules/` provide a default factory that
  returns matching and processing functions.
- `src/common/` contains behavior shared across converter modules; `src/helpers/` contains reusable EPUB, XHTML, XML, string, and template
  utilities.
- Tests are under `test/` and generally mirror `src/`; fixtures are in `test/fixtures/`.

For project usage and module authoring, start with [README.md](README.md). See [converterrc_example.json](converterrc_example.json) for
configuration, [SUPPORTED_TITLES.md](SUPPORTED_TITLES.md) for supported inputs, and the [common](src/common/README.md) and
[helpers](src/helpers/README.md) notes for those directory boundaries.

## Recommended Commands

- `npm ci` to install dependencies reproducibly.
- `npm test` to run the test suite locally; `npm run test:coverage` is the CI test command.
- `npm run build:tests` to compile and type-check source and tests; `npm run build` to build production output in `lib/`.
- `npm run lint` to check formatting and lint rules; append `-- --fix` to apply automatic fixes.

CI runs `npm run build:tests`, `npm run lint`, and `npm run test:coverage`.

## Tools

- Use native file tools (read, glob, grep) instead of chaining bash commands like cat or find when exploring.
- Run tests after multi-file changes.
- Finally, make sure everything still builds without errors or warnings.

## Additional notes

- Don't ever use copyrighted material directly from the books. Change it to be mock words / skeleton or use public domain text (like lorem
  ipsum) before using in tests.
- Tests that need to clean up like global variables (like `process.env`) or files / directories should happen outside of tests (jest
  equivalent of `afterEach`, or more specific to tests if available)
- When using code oneliners, pretty print them so that they can be easily reviewed.

## Styling

### Common

For exact styling see `.editorconfig`, `eslint.config.mjs` and `.prettierrc`, but the rough points are:

- use LF line endings
- use 2 SPACE indentation, where TAB is not required

When there are longer xml, json or similar data that needs to be embedded, prettify them instead of having one big line.

### Tests

Tests are split into individual files to not have a single one grow too big. The naming directory and naming scheme is roughly
`FOLDER/MODULENAME(.FUNCTION).test.ts`, where `FUNCTION` is optional if the module is small, otherwise for a specific function if that
single function testing is large, or consider other names like `.helpers.`.

Tests make use of vitest. Each test needs to be within a `describe` block, which is commonly the function name that is tested. Each test's
name should be descriptive about what it is testing.

Unit tests should:

- be concise and generally not use the "Arrange, Act, Assert" style, but should be considered for larger tests.
- be descriptive and minimal, generally not requiring comments, but more complex or "magic" should be commented.
- share setup if possible.
- should not do cleanup in the tests themselves, use `afterEach` / `afterAll` for cleanup.

End-to-End tests should be separate from unit tests. The `src/bin/main.ts` file does not need to be tested as it is just a call of
`src/main.ts`.

If there are any uncertainties, ask for clarification.

## Change size

- We follow the "a commit should be minimal", at least in a reasonable amount. Example: don't split every single line change into a commit,
  but don't bloat it to the size of many different features. Pause and ask the user if unsure.
