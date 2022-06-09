# Coverty

Simple EPUB(-like) converter collection.

Note: This is mainly a personal project, so it may or may not get more useable.

## What this is

- A collection of scripts to transform a input epub(-like) to another epub output

## What this is not

- This Project is not performance oriented
- This Project is not intendet for Production use

## How to use

Requirements:

- NodeJS 18 (it is the only version currently tested)

### Running

To transform a support epub(-like), the input will need to be put into `CONVERTER_READ_PATH`(defined in `src/main.ts`), which is by default `~/Downloads/converty-in`, and then the project needs to be run:

```sh
# This script assumes the CWD/PWD is the project root

# Make sure the input directory exists
mkdir -p ~/Downloads/converty-in

# Copy input file to the transform input
cp /path/to/input.epub ~/Downloads/converty-in

# Making sure everything is installed
yarn install

# And Running the Project
yarn run run

# Inspecting the output files
ls -al ~/Downloads/converty-out
```

Note: The project can be run first to have it create the folders.

### Adding Modules

Custom Modules can be added and placed in `src/modules`, and all modules have to have a default-export which returns `ConverterModule`(`src/utils.ts`), and the rest is up to the module.

See existing Modules for help.

## Currently Supported Titles

See [Supported Titles](./SUPPORTED_TITLES.md).

## Disclaimer

This Project is only a collection of scripts to **transform** inputs to outputs, it does not contain any of the things it is meant to transform.
