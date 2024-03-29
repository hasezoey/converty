# Coverty

Simple EPUB(-like) converter collection.

Note: This is mainly a personal project, so it may or may not get more useable.

## What this is

- A collection of scripts to transform a input EPUB(-like) to a Consistent EPUB with the styles that are wanted by the User

## What this is not

- This Project is not performance oriented
- This Project is not intendet for Production use

## How to use

Requirements:

- NodeJS 18 (it is the only version currently tested)
- Yarn (or copy the command manually from the package.json)

### Running

To transform a supported epub(-like), the input will need to be put into `CONVERTER_READ_PATH`(defined in `src/main.ts`), which is by default `~/Downloads/converty-in`, and then the project needs to be run:

```sh
# This script assumes the CWD/PWD is the project root

# Make sure the input directory exists
mkdir -p ~/Downloads/converty-in

# Copy input file to the transform input
# No Data in the input path is touched, but it is safer to copy it in
cp /path/to/input.epub ~/Downloads/converty-in

# Making sure everything is installed
yarn install

# And Running the Project
yarn run run

# Inspecting the output files
ls -al ~/Downloads/converty-out
```

Note: The project can be run first to have it create the folders (like input and output).  
Note: The inputs need to be named according to `INPUT_MATCH_REGEX` (defined in each module), this is done to easily match files to modules.

### Adding Modules

Custom Modules can be added and placed in `src/modules`, and all modules must have a default-export which returns a object with the interface of `ConverterModule`(`src/utils.ts`), and the rest (like processing the input to output) is up to the module.

See existing Modules for help.

### Extra modes

There is the environment variable `DEBUG_OUTPUT` which will output files uncompressed and prettified where possible.

#### run:compare script

There is also a comparison script `run:compare` which will create a separate output directory along with `input` and `output` which is a git repository, the script will run like normal and then commit all the output in the git repository to make comparing changes easier (commit messages include the commit they are generated from).

This makes regression testing much easier by having a simple script to run to find what changed or while using `git bisect`.  

Makes use of `DEBUG_OUTPUT` to pretty print the output.

## Currently Supported Titles

See [Supported Titles](./SUPPORTED_TITLES.md).

## Disclaimer

This Project is only a collection of scripts to **transform** inputs to outputs, it does not contain any of the things it is meant to transform.
