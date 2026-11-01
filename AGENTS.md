# Agent instructions

## Tech Stack

This project uses Typescript. Avoid pure javascript, except for configs (ie eslint.mjs).
We also make use of packages like `jsdom` for complete xhtml and style reading and modification.

## Recommended Commands

- `npm test`
- `npm run lint` / `npm run lint --fix`
- `npm run build:tests` to build & type-check all typescript files

## Tools

- Use native file tools (read, glob, grep) instead of chaining bash commands like cat or find when exploring.
- Run tests after multi-file changes.
- Finally, make sure everything still builds without errors or warnings.

## Additional notes

- Dont ever use copyrighted material directly from the books. Change it to be mock words / skeleton before using in tests.
- Tests that need to clean-up like global variables (ex. `process.env`) or files / directories should happen outside of tests (jest equivalent of `afterEach`, or more specific to tests if available)

## Styling

For exact styling see `.editorconfig`, `eslint.config.mjs` and `.prettierrc`, but the rought points are:
- use LF line endings
- use 2 SPACE indentation, where TAB is not required
