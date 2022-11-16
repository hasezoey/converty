import * as utils from './utils.js';
import { promises as fspromises } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import downloadsFolder from 'downloads-folder';

const log = utils.createNameSpace('main');
const currentModulePath = path.dirname(fileURLToPath(import.meta.url));

// STATIC OPTIONS

/** Project name, which will be used for paths */
const PROJECT_NAME = 'converty';

/** Set the output path of where to store outputs (and in some cases also inputs) */
const CONVERTER_BASE_PATH_FALLBACK = path.resolve(downloadsFolder(), PROJECT_NAME);
/** Create a link in the Downloads-Folder to the path where "CONVERTER_BASE_PATH" is, only if they are not the same */
const CREATE_DOWNLOADS_LINK = true;
/** Path to the config file, if relative will be resolved relative to the project root */
const CONFIG_PATH = './converterrc.json';
/** Overwrite files to process instead of finding all */
const OVERWRITE_FILES: undefined | string[] = undefined;
/** Set "No Module for File" Errors to be Silent */
const SILENT_NO_MODULE_FOR_FILE: boolean = false;
/** Set to allow Directories as input to modules, instead of just files */
const ALLOW_DIR_AS_INPUT: boolean = true;

/** The Loaded Config of the Project */
let config: ConverterPConfig | undefined = undefined;

interface ConverterPConfig {
  /** The Absolute path to the Base Converter Dir to use, the Project-name will be appended */
  baseConverterPath?: string;
}

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
        return file.endsWith('.js');
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

/**
 * Helper function to get the DownloadBasePath
 * @returns The download base path
 */
function getConverterBasePath(): string {
  if (!utils.isNullOrUndefined(config) && !!config.baseConverterPath) {
    return path.resolve(config.baseConverterPath, PROJECT_NAME);
  }

  return CONVERTER_BASE_PATH_FALLBACK;
}

/**
 * Helper function to out-source the creation of a symlink in the downloads folder to the base-path
 */
async function createDownloadsSymlink() {
  if (CREATE_DOWNLOADS_LINK) {
    const converterBasePath = getConverterBasePath();
    const downloadsFolderPath = path.resolve(downloadsFolder(), PROJECT_NAME);
    // using "lstat" because otherwise it will read the link's content instead of the link itself
    const downloadsFolderPathStat = await utils.lstatPath(downloadsFolderPath);

    if (downloadsFolderPath !== converterBasePath) {
      log('Checking / Creating symlink at (symlink, target)', downloadsFolderPath, converterBasePath);

      // extra if, because of the "else"
      if (utils.isNullOrUndefined(downloadsFolderPathStat)) {
        // try to create a symlink in the downloads folder, dont throw a error if it does not work
        await fspromises.symlink(converterBasePath, downloadsFolderPath, 'dir').catch((err) => {
          console.log('Creating Symlink in downloads folder failed:', err);
        });
      } else {
        // check if the existing path is already a symlink and if that symlink points to the same point already
        if (downloadsFolderPathStat.isSymbolicLink()) {
          const symlinkTo = await fspromises.readlink(downloadsFolderPath);

          // dont say anything if the symlink already exists and points to the correct path
          if (symlinkTo === converterBasePath) {
            return;
          }

          console.log('A Symlink already exists in the downloads folder!'.red);

          return;
        }

        console.log('Failed to create Symlink in downloads folder because path already exists!'.red);
      }
    }
  }
}

async function main_loop() {
  // multiple "../" because "import.meta.url" resolves to "lib/main.js"
  const configPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../', CONFIG_PATH);

  if (await utils.pathExists(configPath)) {
    log('Trying to load config at path', configPath);
    try {
      const read = (await fspromises.readFile(configPath)).toString();
      config = JSON.parse(read);
      log('Loaded config at path', configPath);
    } catch (err) {
      console.log('Failed to load Config:'.red, err);
    }
  } else {
    log('No Config found at', configPath);
  }

  const converterBasePath = getConverterBasePath();
  const converterINPUTPath = path.join(converterBasePath, 'input');
  const converterOUTPUTPath = path.join(converterBasePath, 'output');

  // create directories in case they do not exist for future use
  utils.mkdir(converterINPUTPath);
  utils.mkdir(converterOUTPUTPath);
  await createDownloadsSymlink();

  log('Starting Main Loop');
  const modules = await load_modules();

  if (modules.length === 0) {
    throw new Error('No Modules');
  }

  const finished: string[] = [];

  // call the "ready" function on all modules that have it
  for (const module of modules) {
    if (typeof module.ready === 'function') {
      await module.ready();
    }
  }

  console.log('Starting to Process'.grey);
  log(`READ & OUTPUT Path: "${converterINPUTPath}", "${converterOUTPUTPath}"`);

  const waitingFiles: Set<string> = new Set();

  for (const foundPath of await fspromises.readdir(converterINPUTPath)) {
    const fullPath = path.resolve(converterINPUTPath, foundPath);
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
    console.log('Processing "'.green + path.relative(converterINPUTPath, file).grey + '"'.green);

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
      converterInputPath: converterINPUTPath,
      converterOutputPath: converterOUTPUTPath,
      fileInputPath: file,
    });

    // the following paths are made relative, to have less verbose output in the log
    console.log(
      'Finished Processing File "'.green +
        path.relative(converterINPUTPath, file).toString().grey +
        '" into "'.green +
        path.relative(converterOUTPUTPath, finishedPath).grey +
        '"'.green
    );
    finished.push(file);
  }
}

main_loop();
