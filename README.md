# Converty

Simple EPUB(-like) converter collection.

Note: This is mainly a personal project, so it may or may not get more usable.

## What this is

- A collection of scripts to transform an input EPUB-like to a consistent EPUB matching the user's desired styles.

## What this is not

- This project is not performance-oriented
- This project is not intended for production use

## How to use

Requirements:

- NodeJS 18 (it is the only version currently tested)
- npm (or copy the command manually from the package.json)

### Running

To transform a supported epub-like, the input will need to be put into `CONVERTER_READ_PATH`(defined in `src/main.ts`), which is by default `~/Downloads/converty-in`, and then the project needs to be run:

```sh
# This script assumes the CWD/PWD is the project root

# Make sure the input directory exists
mkdir -p ~/Downloads/converty-in

# Copy input file to the transform input
# No data in the input path is touched, but it is safer to copy it.
cp /path/to/input.epub ~/Downloads/converty-in

# Making sure everything is installed
npm install

# And Running the Project
npm run run

# Inspecting the output files
ls -al ~/Downloads/converty-out
```

Note: The project can be run first to have it create the folders (like input and output).  
Note: The inputs need to be named according to `INPUT_MATCH_REGEX` (defined in each module), which is done to easily match files to modules.

### Adding Modules

Custom Modules can be added and placed in `src/modules`, and all modules must have a default export returning an object with the `ConverterModule`(`src/utils.ts`) interface, and the rest (like processing the input to output) is up to the module.

See existing `modules` for help.

### Testing

The project uses [Vitest](https://vitest.dev/) as the test framework. Tests live in the `test/` directory and follow the `*.test.ts` naming convention.

```sh
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Extra modes

There is the environment variable `DEBUG_OUTPUT` which will output files uncompressed and prettified where possible.

#### run:compare script

The compare script `run:compare` will create a separate output directory, which is a git repository.
This can be used for comparing book changes against code changes.

This makes regression testing much easier by having a simple script to run to find what changed or when using `git bisect`.  

Makes use of `DEBUG_OUTPUT` to pretty print the output.

## Currently Supported Titles

See [Supported Titles](./SUPPORTED_TITLES.md).

## Disclaimer

This project is only a collection of scripts to **transform** inputs to outputs; it does not contain any of the things it is meant to transform.
