import * as utils from './utils.js';
import { promises as fspromises } from 'fs';
import * as path from 'path';
import { homedir } from 'os';

const log = utils.createNameSpace('main');
const currentModulePath = utils.getCurrentModuleDirectory(import.meta.url);

// STATIC OPTIONS

/** Project name, which will be used for paths */
const PROJECT_NAME = 'converty';

/** Converter input path */
const CONVERTER_READ_PATH = path.resolve(homedir(), 'Downloads', `${PROJECT_NAME}-in`);
/** Converter output path */
const CONVERTER_OUT_PATH = path.resolve(homedir(), 'Downloads', `${PROJECT_NAME}-out`);
/** Overwrite files to process instead of finding all */
const OVERWRITE_FILES: undefined | string[] = undefined;
/** Set "No Module for File" Errors to be Silent */
const SILENT_NO_MODULE_FOR_FILE: boolean = false;
/** Set to allow Directories as input to modules, instead of just files */
const ALLOW_DIR_AS_INPUT: boolean = true;

// CODE

class ModulesError extends Error {
  constructor(public module: string, public err: Error) {
    super(`A Error happened with Module "${module}""`);
  }
}

async function load_modules(): Promise<utils.ConverterModuleStore[]> {
  log('Loading Modules');
  const files = await fspromises.readdir(path.join(currentModulePath, './modules'));

  return Promise.all(
    files
      .filter((file) => {
        // DEBUG: ignore some modules
        return file.endsWith('.js') && !(file.startsWith('nhentai') || file.startsWith('webtoons'));
      })
      .map((file) => {
        log(`Loading Module "${file}"`);

        const full_file = path.join(currentModulePath, 'modules', file);

        return import(full_file)
          .then((module) => {
            const output = module.default();

            utils.assertion(typeof output === 'object', new Error(`Module "${full_file}" default did not return a object`));
            utils.assertion(typeof output.matcher == 'function', new Error(`Module "${full_file}" did not return a "matcher" function`));
            utils.assertion(typeof output.process == 'function', new Error(`Module "${full_file}" did not return a "process" function`));

            return { ...output, name: file };
          })
          .catch((err) => {
            throw new ModulesError(file, err);
          });
      })
  );
}

async function main_loop() {
  log('Starting Main Loop');
  const modules = await load_modules();

  if (modules.length === 0) {
    throw new Error('No Modules');
  }

  await utils.mkdir(CONVERTER_READ_PATH);

  const finished: string[] = [];

  // call the "ready" function on all modules that have it
  for (const module of modules) {
    if (typeof module.ready === 'function') {
      await module.ready();
    }
  }

  console.log('Starting to Process'.grey);
  log(`READ & OUTPUT Path: "${CONVERTER_READ_PATH}", "${CONVERTER_OUT_PATH}"`);

  // create directories in case they do not exist for future use
  utils.mkdir(CONVERTER_READ_PATH);
  utils.mkdir(CONVERTER_OUT_PATH);

  const waitingFiles: Set<string> = new Set();

  for (const foundPath of await fspromises.readdir(CONVERTER_READ_PATH)) {
    const fullPath = path.resolve(CONVERTER_READ_PATH, foundPath);
    const stat = await utils.statPath(fullPath);

    // ignore all paths that are not possible to read or are not a file
    if (utils.isNullOrUndefined(stat) || (!stat.isFile() && !(ALLOW_DIR_AS_INPUT && stat.isDirectory()))) {
      continue;
    }

    // skip files if not in "OVERWRITE_FILES", if defined
    if (!utils.isNullOrUndefined(OVERWRITE_FILES) && !OVERWRITE_FILES.includes(foundPath)) {
      log(`skipping file "${foundPath}" because its not in OVERWRITE_FILES`);
      continue;
    }

    log(`found path: "${fullPath}"`);
    waitingFiles.add(fullPath);
  }

  if (waitingFiles.size <= 0) {
    throw new Error('Found no files to process');
  }

  for (const file of waitingFiles) {
    // the following paths are made relative, to have less verbose output in the log
    console.log('Processing "'.green + path.relative(CONVERTER_READ_PATH, file).grey + '"'.green);

    let processingModel: utils.ConverterModule | undefined = undefined;
    for (const module of modules) {
      if (module.matcher(file)) {
        processingModel = module;
        break;
      }
    }

    // ignore files that dont have a module, but print error
    if (utils.isNullOrUndefined(processingModel)) {
      if (!SILENT_NO_MODULE_FOR_FILE) {
        console.error(new Error(`Could not find a module for path "${file}"`));
      }

      continue;
    }

    const finishedPath = await processingModel.process({
      converterInputPath: CONVERTER_READ_PATH,
      converterOutputPath: CONVERTER_OUT_PATH,
      fileInputPath: file,
    });

    // the following paths are made relative, to have less verbose output in the log
    console.log(
      'Finished Processing File "'.green +
        path.relative(CONVERTER_READ_PATH, file).toString().grey +
        '" into "'.green +
        path.relative(CONVERTER_OUT_PATH, finishedPath).grey +
        '"'.green
    );
    finished.push(file);
  }
}

main_loop();
